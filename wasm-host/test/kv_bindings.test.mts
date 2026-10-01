// Tests for the compiled bindings (dist/kv_bindings.js, the file wasm-bindgen ships).
// Run with `pnpm test` in wasm-host/, which builds first.
import { test, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire, registerHooks } from 'node:module'

type Bindings = typeof import('../src/kv_bindings.js')

const require = createRequire(import.meta.url)
const MODULE_PATH = require.resolve('../dist/kv_bindings.js')
const PREFIX = 'subconverter-data-v1/'

// Environment variables that influence backend detection; cleared for every test
const ENV_KEYS = [
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'NETLIFY',
  'NETLIFY_BLOBS_CONTEXT',
]

// State the fake modules below read at call time (each ESM module is only loaded once)
interface UpstashState {
  data: Map<string, unknown>
  config?: { url: string; token: string }
  scanPageSize: number
  scanCalls: { cursor: string; match: string }[]
}
interface NetlifyState {
  data: Map<string, Uint8Array>
  storeName?: string
}
const testGlobals = globalThis as typeof globalThis & {
  __testWorkersEnv?: Record<string, unknown>
  __testUpstash?: UpstashState
  __testNetlify?: NetlifyState
}

// Stand-ins for the Workers-only `cloudflare:workers` module and the storage client packages
const FAKE_MODULES: Record<string, string> = {
  'cloudflare:workers': `
    export const env = new Proxy({}, { get: (_, key) => globalThis.__testWorkersEnv?.[key] })
  `,
  '@upstash/redis': `
    export class Redis {
      constructor(config) {
        this.state = globalThis.__testUpstash
        this.state.config = config
      }
      async get(key) { return this.state.data.has(key) ? this.state.data.get(key) : null }
      async set(key, value) { this.state.data.set(key, value); return 'OK' }
      async exists(key) { return this.state.data.has(key) ? 1 : 0 }
      async del(key) { return this.state.data.delete(key) ? 1 : 0 }
      async scan(cursor, { match }) {
        this.state.scanCalls.push({ cursor, match })
        const prefix = match.slice(0, -1)
        const names = [...this.state.data.keys()].filter((k) => k.startsWith(prefix)).sort()
        const start = Number(cursor)
        const end = start + this.state.scanPageSize
        return [end >= names.length ? '0' : String(end), names.slice(start, end)]
      }
    }
  `,
  '@netlify/blobs': `
    export function getStore(name) {
      const state = globalThis.__testNetlify
      state.storeName = name
      const { data } = state
      return {
        async get(key, { type } = {}) {
          if (!data.has(key)) return null
          const bytes = data.get(key)
          return type === 'arrayBuffer'
            ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
            : new TextDecoder().decode(bytes)
        },
        async set(key, value) {
          data.set(key, typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value))
        },
        async getMetadata(key) { return data.has(key) ? { etag: 'etag', metadata: {} } : null },
        async delete(key) { data.delete(key) },
        async list({ prefix = '' } = {}) {
          const keys = [...data.keys()].filter((k) => k.startsWith(prefix)).sort()
          return { blobs: keys.map((key) => ({ key, etag: 'etag' })), directories: [] }
        },
      }
    }
  `,
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier in FAKE_MODULES) {
      return { url: `test-fake:${specifier}`, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url.startsWith('test-fake:')) {
      const source = FAKE_MODULES[url.slice('test-fake:'.length)]
      return { format: 'module', source, shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})

let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) delete process.env[k]
  for (const method of ['log', 'warn', 'error', 'debug'] as const) {
    mock.method(console, method, () => {})
  }
})

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  delete testGlobals.__testWorkersEnv
  delete testGlobals.__testUpstash
  delete testGlobals.__testNetlify
  mock.restoreAll()
})

// The module keeps the selected backend and env lookups in module state, so load a fresh copy per test
function loadBindings(): Bindings {
  delete require.cache[MODULE_PATH]
  return require(MODULE_PATH) as Bindings
}

// In-memory stand-in for a Workers KVNamespace binding
class FakeKvNamespace {
  data = new Map<string, string | Uint8Array>()
  listCalls: { prefix: string; cursor?: string }[] = []
  pageSize: number

  constructor(pageSize = 1000) {
    this.pageSize = pageSize
  }

  async get(key: string, options: { type: 'text' | 'arrayBuffer' | 'stream' }) {
    const value = this.data.get(key)
    if (value === undefined) return null
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
    switch (options.type) {
      case 'arrayBuffer':
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      case 'stream':
        return new Blob([bytes]).stream()
      default:
        return new TextDecoder().decode(bytes)
    }
  }

  // Keeps the given reference, like a write that reads its input later
  async put(key: string, value: string | Uint8Array) {
    this.data.set(key, value)
  }

  async delete(key: string) {
    this.data.delete(key)
  }

  async list({ prefix = '', cursor }: { prefix?: string; cursor?: string } = {}) {
    this.listCalls.push({ prefix, cursor })
    const names = [...this.data.keys()].filter((k) => k.startsWith(prefix)).sort()
    const start = cursor ? Number(cursor) : 0
    const end = start + this.pageSize
    const complete = end >= names.length
    return {
      keys: names.slice(start, end).map((name) => ({ name })),
      list_complete: complete,
      ...(complete ? {} : { cursor: String(end) }),
    }
  }
}

function useUpstash(pageSize = 1000): UpstashState {
  testGlobals.__testUpstash = { data: new Map(), scanPageSize: pageSize, scanCalls: [] }
  return testGlobals.__testUpstash
}

function useNetlify(): NetlifyState {
  process.env.NETLIFY_BLOBS_CONTEXT = 'test-context'
  testGlobals.__testNetlify = { data: new Map() }
  return testGlobals.__testNetlify
}

const bytes = (...values: number[]) => new Uint8Array(values)

// --- In-memory fallback ---

test('in-memory fallback handles bytes, text, exists, list and delete', async () => {
  const kv = loadBindings()

  await kv.kv_set('rules/a.list', bytes(1, 2, 3))
  await kv.kv_set_text('rules/b.list', 'hello')
  await kv.kv_set_text('other/c', 'x')

  assert.deepEqual(await kv.kv_get('rules/a.list'), bytes(1, 2, 3))
  assert.equal(await kv.kv_get_text('rules/b.list'), 'hello')
  assert.equal(await kv.kv_get('missing'), undefined)
  assert.equal(await kv.kv_get_text('missing'), undefined)
  assert.equal(await kv.kv_exists('rules/a.list'), true)
  assert.equal(await kv.kv_exists('missing'), false)
  assert.deepEqual((await kv.kv_list('rules/')).sort(), ['rules/a.list', 'rules/b.list'])

  await kv.kv_del('rules/a.list')
  assert.equal(await kv.kv_exists('rules/a.list'), false)
})

test('outside Workers the cloudflare:workers import fails and storage stays in memory', () => {
  // Plain Node without the test hooks, so the real import failure path runs
  const script = `
    console.log = () => {}
    const kv = require(${JSON.stringify(MODULE_PATH)})
    ;(async () => {
      await kv.kv_set_text('a', 'value')
      process.stdout.write(JSON.stringify({
        text: await kv.kv_get_text('a'),
        inMemory: kv.localStorageMap.has('a'),
      }))
    })()
  `
  const env = { ...process.env }
  for (const k of ENV_KEYS) delete env[k]
  const output = execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8' })
  assert.deepEqual(JSON.parse(output), { text: 'value', inMemory: true })
})

// --- Cloudflare Workers KV ---

test('Workers KV binding env.KV stores values under the versioned prefix', async () => {
  const ns = new FakeKvNamespace()
  testGlobals.__testWorkersEnv = { KV: ns }
  const kv = loadBindings()

  await kv.kv_set('rules/a.list', bytes(1, 2, 3))
  await kv.kv_set_text('rules/b.list', 'héllo')

  assert.deepEqual([...ns.data.keys()].sort(), [`${PREFIX}rules/a.list`, `${PREFIX}rules/b.list`])
  assert.deepEqual(await kv.kv_get('rules/a.list'), bytes(1, 2, 3))
  assert.equal(await kv.kv_get_text('rules/b.list'), 'héllo')
  // Text can also be read back as UTF-8 bytes
  assert.deepEqual(await kv.kv_get('rules/b.list'), new TextEncoder().encode('héllo'))
  assert.equal(await kv.kv_get('missing'), undefined)
  assert.equal(await kv.kv_get_text('missing'), undefined)
  assert.equal(kv.localStorageMap.size, 0)
})

test('Workers KV binding supports exists and delete', async () => {
  const ns = new FakeKvNamespace()
  testGlobals.__testWorkersEnv = { KV: ns }
  const kv = loadBindings()

  await kv.kv_set_text('a', 'value')
  assert.equal(await kv.kv_exists('a'), true)
  assert.equal(await kv.kv_exists('b'), false)

  await kv.kv_del('a')
  assert.equal(await kv.kv_exists('a'), false)
  assert.equal(ns.data.size, 0)
})

test('Workers KV binding list follows cursors and strips the prefix', async () => {
  const ns = new FakeKvNamespace(2)
  testGlobals.__testWorkersEnv = { KV: ns }
  ns.data.set('foreign-key', 'not ours')
  const kv = loadBindings()

  for (const name of ['e', 'a', 'd', 'b', 'c']) {
    await kv.kv_set_text(`rules/${name}.list`, name)
  }
  await kv.kv_set_text('other/x', 'x')

  assert.deepEqual(await kv.kv_list('rules/'), [
    'rules/a.list',
    'rules/b.list',
    'rules/c.list',
    'rules/d.list',
    'rules/e.list',
  ])
  // 5 keys at 2 per page
  assert.deepEqual(
    ns.listCalls.map((c) => c.prefix),
    Array(3).fill(`${PREFIX}rules/`),
  )
  // Keys outside the versioned prefix are never returned
  assert.equal((await kv.kv_list('')).length, 6)
})

test('Workers KV kv_set copies bytes before writing', async () => {
  const ns = new FakeKvNamespace()
  testGlobals.__testWorkersEnv = { KV: ns }
  const kv = loadBindings()

  // Simulates a view into WASM memory that is reused after the call
  const source = bytes(1, 2, 3)
  await kv.kv_set('a', source)
  source.fill(0)

  assert.deepEqual(await kv.kv_get('a'), bytes(1, 2, 3))
})

test('Workers without a KV binding fall back to in-memory storage', async () => {
  testGlobals.__testWorkersEnv = { OTHER: new FakeKvNamespace() }
  const kv = loadBindings()

  await kv.kv_set_text('a', 'value')
  assert.equal(await kv.kv_get_text('a'), 'value')
  assert.equal(kv.localStorageMap.size, 1)
})

test('a KV binding that is not a KV namespace is ignored', async () => {
  testGlobals.__testWorkersEnv = { KV: { get() {} } }
  const kv = loadBindings()

  await kv.kv_set_text('a', 'value')
  assert.equal(kv.localStorageMap.size, 1)
})

// --- Upstash Redis ---

test('Upstash uses the standard UPSTASH_REDIS_REST_* variables and the versioned prefix', async () => {
  const upstash = useUpstash()
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'token-1'
  const kv = loadBindings()

  await kv.kv_set_text('rules/a.list', 'hello')
  assert.deepEqual(upstash.config, { url: 'https://example.upstash.io', token: 'token-1' })
  assert.deepEqual([...upstash.data.keys()], [`${PREFIX}rules/a.list`])
  assert.equal(await kv.kv_get_text('rules/a.list'), 'hello')
  assert.equal(await kv.kv_get_text('missing'), undefined)
  assert.equal(await kv.kv_exists('rules/a.list'), true)

  await kv.kv_del('rules/a.list')
  assert.equal(await kv.kv_exists('rules/a.list'), false)
})

test('Upstash also accepts the KV_REST_API_* variables set by the Vercel integration', async () => {
  const upstash = useUpstash()
  process.env.KV_REST_API_URL = 'https://vercel.upstash.io'
  process.env.KV_REST_API_TOKEN = 'token-2'
  const kv = loadBindings()

  await kv.kv_set_text('a', 'value')
  assert.deepEqual(upstash.config, { url: 'https://vercel.upstash.io', token: 'token-2' })
})

test('Upstash list follows SCAN cursors and strips the prefix', async () => {
  const upstash = useUpstash(2)
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'token-1'
  const kv = loadBindings()

  for (const name of ['c', 'a', 'b']) {
    await kv.kv_set_text(`rules/${name}`, name)
  }
  await kv.kv_set_text('other/x', 'x')

  assert.deepEqual((await kv.kv_list('rules/')).sort(), ['rules/a', 'rules/b', 'rules/c'])
  assert.deepEqual(upstash.scanCalls, [
    { cursor: '0', match: `${PREFIX}rules/*` },
    { cursor: '2', match: `${PREFIX}rules/*` },
  ])
})

test('Upstash credentials take precedence over a Workers KV binding', async () => {
  const upstash = useUpstash()
  const ns = new FakeKvNamespace()
  testGlobals.__testWorkersEnv = { KV: ns }
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'token-1'
  const kv = loadBindings()

  await kv.kv_set_text('a', 'value')
  assert.equal(upstash.data.size, 1)
  assert.equal(ns.data.size, 0)
})

// --- Netlify Blobs ---

test('Netlify Blobs uses the versioned store and round-trips bytes and text', async () => {
  const netlify = useNetlify()
  const kv = loadBindings()

  const source = bytes(1, 2, 3)
  await kv.kv_set('rules/a.list', source)
  source.fill(0)
  await kv.kv_set_text('rules/b.list', 'héllo')

  assert.equal(netlify.storeName, 'subconverter-data-v1')
  assert.deepEqual(await kv.kv_get('rules/a.list'), bytes(1, 2, 3))
  assert.equal(await kv.kv_get_text('rules/b.list'), 'héllo')
  assert.equal(await kv.kv_get('missing'), undefined)
  assert.equal(await kv.kv_get_text('missing'), undefined)
})

test('Netlify Blobs supports exists, list and delete', async () => {
  useNetlify()
  const kv = loadBindings()

  await kv.kv_set_text('rules/a', 'a')
  await kv.kv_set_text('rules/b', 'b')
  await kv.kv_set_text('other/c', 'c')

  assert.equal(await kv.kv_exists('rules/a'), true)
  assert.equal(await kv.kv_exists('missing'), false)
  assert.deepEqual(await kv.kv_list('rules/'), ['rules/a', 'rules/b'])

  await kv.kv_del('rules/a')
  assert.equal(await kv.kv_exists('rules/a'), false)
})
