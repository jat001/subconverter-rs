// Tests for the compiled bindings (dist/kv_bindings.js, the file wasm-bindgen ships).
// Run with `pnpm test` in wasm-host/, which builds first.
import { test, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire, registerHooks } from 'node:module'

type Bindings = typeof import('../src/kv_bindings.js')

// The WebAssembly global is only typed by the DOM lib, which this project does not load
declare const WebAssembly: {
  Memory: new (descriptor: { initial: number }) => { buffer: ArrayBuffer; grow(delta: number): number }
}

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

// State the fakes below read at call time (each fake ESM module is only loaded once)
interface UpstashState {
  server: Map<string, string> // full key -> stored value, what Redis holds
  config?: { url: string; token: string; automaticDeserialization?: boolean }
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
  __testFakeRedis?: typeof FakeRedis
}

// --- Fake @upstash/redis ---
// Mimics what @upstash/redis 1.39 does to values (pkg/commands/command.ts, pkg/util.ts):
// - defaultSerializer passes strings, numbers and booleans through and JSON.stringify's the rest,
//   so a Uint8Array is stored as '{"0":1,"1":2,...}';
// - unless automaticDeserialization is false, replies go through parseResponse, so "123" comes
//   back as 123 and "{...}" as an object;
// - Redis rejects a SCAN cursor that is not an integer.

function upstashState(): UpstashState {
  assert.ok(testGlobals.__testUpstash, 'useUpstash() not called')
  return testGlobals.__testUpstash
}

function defaultSerializer(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : JSON.stringify(value)
}

function parseRecursive(obj: unknown): unknown {
  const parsed = Array.isArray(obj)
    ? obj.map((o) => {
        try {
          return parseRecursive(o)
        } catch {
          return o
        }
      })
    : JSON.parse(obj as string)
  if (typeof parsed === 'number' && parsed.toString() !== obj) {
    return obj
  }
  return parsed
}

function parseResponse(result: unknown): unknown {
  try {
    return parseRecursive(result)
  } catch {
    return result
  }
}

class FakeRedis {
  automaticDeserialization: boolean

  constructor(config: NonNullable<UpstashState['config']>) {
    upstashState().config = config
    this.automaticDeserialization = config.automaticDeserialization !== false
  }

  deserialize(result: unknown) {
    return this.automaticDeserialization ? parseResponse(result) : result
  }

  async get(key: string) {
    return this.deserialize(upstashState().server.get(key) ?? null)
  }

  async set(key: string, value: unknown) {
    upstashState().server.set(key, defaultSerializer(value))
    return 'OK'
  }

  async exists(...keys: string[]) {
    return keys.filter((key) => upstashState().server.has(key)).length
  }

  async del(...keys: string[]) {
    return keys.filter((key) => upstashState().server.delete(key)).length
  }

  async scan(cursor: string | number, { match = '*' }: { match?: string; count?: number } = {}) {
    if (!/^\d+$/.test(String(cursor))) {
      throw new Error('ERR invalid cursor')
    }
    const state = upstashState()
    state.scanCalls.push({ cursor: String(cursor), match })
    const prefix = match.endsWith('*') ? match.slice(0, -1) : match
    const names = [...state.server.keys()].filter((k) => k.startsWith(prefix)).sort()
    const start = Number(cursor)
    const end = start + state.scanPageSize
    const keys = names.slice(start, end)
    // Like deserializeScanResponse: the cursor is left alone
    return [
      end >= names.length ? '0' : String(end),
      this.automaticDeserialization ? keys.map((k) => parseResponse(k)) : keys,
    ]
  }
}
testGlobals.__testFakeRedis = FakeRedis

// Stand-ins for the Workers-only `cloudflare:workers` module and the storage client packages
const FAKE_MODULES: Record<string, string> = {
  'cloudflare:workers': `
    export const env = new Proxy({}, { get: (_, key) => globalThis.__testWorkersEnv?.[key] })
  `,
  '@upstash/redis': `export const Redis = globalThis.__testFakeRedis`,
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
        return new Blob([new Uint8Array(bytes)]).stream()
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

// Upstash backend with the fake client; returns the fake server state
function useUpstash(pageSize = 1000): UpstashState {
  testGlobals.__testUpstash = { server: new Map(), scanPageSize: pageSize, scanCalls: [] }
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
  process.env.UPSTASH_REDIS_REST_TOKEN = 'token-1'
  return testGlobals.__testUpstash
}

function useNetlify(): NetlifyState {
  process.env.NETLIFY_BLOBS_CONTEXT = 'test-context'
  testGlobals.__testNetlify = { data: new Map() }
  return testGlobals.__testNetlify
}

const BACKENDS: Record<string, () => void> = {
  'in-memory': () => {},
  upstash: () => useUpstash(),
  'workers-kv': () => {
    testGlobals.__testWorkersEnv = { KV: new FakeKvNamespace() }
  },
  netlify: () => useNetlify(),
}

const bytes = (...values: number[]) => new Uint8Array(values)
const allByteValues = Uint8Array.from({ length: 256 }, (_, i) => i)

// --- All backends ---

// wasm-bindgen passes &[u8] to JS imports as a view into WASM memory (memory.subarray): the view is
// detached if the memory grows, and Rust reuses the memory once the call resolves.
for (const [backend, setup] of Object.entries(BACKENDS)) {
  const ORIGINAL = [1, 2, 3, 4, 5, 6, 7, 8]

  test(`kv_set keeps the bytes when WASM memory grows during the call (${backend})`, async () => {
    setup()
    const kv = loadBindings()
    const memory = new WebAssembly.Memory({ initial: 1 })
    const view = new Uint8Array(memory.buffer).subarray(64, 64 + ORIGINAL.length)
    view.set(ORIGINAL)

    const pending = kv.kv_set('grown', view)
    memory.grow(1) // detaches the old buffer; the view's length drops to 0
    assert.equal(view.length, 0)
    await pending

    assert.deepEqual(await kv.kv_get('grown'), Uint8Array.from(ORIGINAL))
  })

  test(`kv_set does not keep a view of the caller's memory (${backend})`, async () => {
    setup()
    const kv = loadBindings()
    const memory = new WebAssembly.Memory({ initial: 1 })
    const view = new Uint8Array(memory.buffer).subarray(64, 64 + ORIGINAL.length)
    view.set(ORIGINAL)

    const pending = kv.kv_set('reused', view)
    // Stricter than reality (Rust's borrow keeps these bytes intact until the promise settles),
    // but only a synchronous copy passes it
    view.fill(0xff)
    await pending
    // Rust reuses the memory once the call resolves
    new Uint8Array(memory.buffer).fill(0xee)

    assert.deepEqual(await kv.kv_get('reused'), Uint8Array.from(ORIGINAL))
  })
}

test('kv_set copies a Node Buffer instead of keeping a view of it', async () => {
  const kv = loadBindings()
  const buffer = Buffer.from([1, 2, 3])

  const pending = kv.kv_set('buffer', buffer)
  buffer.fill(0)
  await pending

  assert.deepEqual(await kv.kv_get('buffer'), bytes(1, 2, 3))
})

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

test('Upstash uses the standard UPSTASH_REDIS_REST_* variables without automatic deserialization', async () => {
  const upstash = useUpstash()
  const kv = loadBindings()

  await kv.kv_set_text('a', 'value')
  assert.deepEqual(upstash.config, {
    url: 'https://example.upstash.io',
    token: 'token-1',
    automaticDeserialization: false,
  })
  assert.deepEqual([...upstash.server.keys()], [`${PREFIX}a`])
})

test('Upstash also accepts the KV_REST_API_* variables set by the Vercel integration', async () => {
  const upstash = useUpstash()
  delete process.env.UPSTASH_REDIS_REST_URL
  delete process.env.UPSTASH_REDIS_REST_TOKEN
  process.env.KV_REST_API_URL = 'https://vercel.upstash.io'
  process.env.KV_REST_API_TOKEN = 'token-2'
  const kv = loadBindings()

  await kv.kv_set_text('a', 'value')
  assert.equal(upstash.config?.url, 'https://vercel.upstash.io')
  assert.equal(upstash.config?.token, 'token-2')
})

test('Upstash bytes round-trip through kv_set and kv_get', async () => {
  useUpstash()
  const kv = loadBindings()
  const cases: Record<string, Uint8Array> = {
    empty: new Uint8Array(0),
    all: allByteValues,
    invalidUtf8: bytes(0xff, 0xfe, 0xc3, 0x28, 0x80),
    jsonLooking: new TextEncoder().encode('{"0":1}'),
    // Larger than one String.fromCharCode chunk
    large: Uint8Array.from({ length: 100_000 }, (_, i) => (i * 7) % 256),
  }
  for (const [name, value] of Object.entries(cases)) {
    await kv.kv_set(name, value)
    const read = await kv.kv_get(name)
    assert.ok(read instanceof Uint8Array, `${name}: not a Uint8Array`)
    assert.deepEqual(read, value, name)
  }
})

test('Upstash kv_set stores only the bytes a view covers', async () => {
  useUpstash()
  const kv = loadBindings()

  const memory = bytes(9, 9, 1, 2, 3, 9)
  await kv.kv_set('view', memory.subarray(2, 5))
  assert.deepEqual(await kv.kv_get('view'), bytes(1, 2, 3))
})

test('Upstash text round-trips exactly through kv_set_text and kv_get_text', async () => {
  useUpstash()
  const kv = loadBindings()
  const texts = [
    '123',
    '1.0',
    'true',
    'null',
    '"quoted"',
    '[1,2,3]',
    '{"files":{},"directories":{}}',
    '{"0":104,"1":105}',
    '',
    'plain text',
    'héllo 🌍',
    'subconverter:base64:aGk=',
    'subconverter:text:abc',
  ]
  for (const [i, text] of texts.entries()) {
    await kv.kv_set_text(`text-${i}`, text)
    assert.equal(await kv.kv_get_text(`text-${i}`), text)
  }
})

test('Upstash stores bytes as marked base64 and text as-is', async () => {
  const upstash = useUpstash()
  const kv = loadBindings()

  await kv.kv_set('bytes', new TextEncoder().encode('hi'))
  await kv.kv_set_text('text', '{"files":{}}')
  await kv.kv_set_text('marked', 'subconverter:base64:x')

  assert.equal(upstash.server.get(`${PREFIX}bytes`), 'subconverter:base64:aGk=')
  assert.equal(upstash.server.get(`${PREFIX}text`), '{"files":{}}')
  assert.equal(upstash.server.get(`${PREFIX}marked`), 'subconverter:text:subconverter:base64:x')
})

test('Upstash kv_get and kv_get_text read values written by the other setter', async () => {
  useUpstash()
  const kv = loadBindings()

  const text = '{"rules":["DOMAIN,example.com"]}'
  await kv.kv_set('bytes', new TextEncoder().encode(text))
  await kv.kv_set_text('text', text)
  assert.equal(await kv.kv_get_text('bytes'), text)
  assert.deepEqual(await kv.kv_get('text'), new TextEncoder().encode(text))
})

test('Upstash missing keys read as undefined', async () => {
  useUpstash()
  const kv = loadBindings()

  assert.equal(await kv.kv_get('missing'), undefined)
  assert.equal(await kv.kv_get_text('missing'), undefined)
})

test('Upstash values written before the encoding change are still readable', async () => {
  useUpstash()
  const kv = loadBindings()
  // Written the way the adapter did before: through a client with default options
  const legacy = new FakeRedis({ url: 'https://example.upstash.io', token: 'token-1' })
  // Bytes were JSON.stringify'd by the client: '{"0":0,"1":1,...}'
  await legacy.set(`${PREFIX}legacy-bytes`, allByteValues)
  await legacy.set(`${PREFIX}legacy-empty`, new Uint8Array(0))
  // Text was stored as-is
  const metadata = '{"files":{"a.yaml":{}},"directories":{}}'
  await legacy.set(`${PREFIX}legacy-text`, metadata)
  await legacy.set(`${PREFIX}legacy-number`, '123')

  assert.deepEqual(await kv.kv_get('legacy-bytes'), allByteValues)
  assert.deepEqual(await kv.kv_get('legacy-empty'), new Uint8Array(0))
  assert.equal(await kv.kv_get_text('legacy-text'), metadata)
  assert.equal(await kv.kv_get_text('legacy-number'), '123')
})

test('Upstash supports exists and delete on prefixed keys', async () => {
  useUpstash()
  const kv = loadBindings()

  await kv.kv_set('dir/a', bytes(1))
  assert.equal(await kv.kv_exists('dir/a'), true)
  assert.equal(await kv.kv_exists('dir/b'), false)

  await kv.kv_del('dir/a')
  assert.equal(await kv.kv_exists('dir/a'), false)
  assert.equal(await kv.kv_get('dir/a'), undefined)
})

test('Upstash list scans from cursor 0, follows cursors and strips the prefix', async () => {
  const upstash = useUpstash(2)
  const kv = loadBindings()

  for (const name of ['c', 'a', '123']) {
    await kv.kv_set_text(`rules/${name}`, name)
  }
  await kv.kv_set_text('other/x', 'x')

  assert.deepEqual((await kv.kv_list('rules/')).sort(), ['rules/123', 'rules/a', 'rules/c'])
  assert.deepEqual(upstash.scanCalls, [
    { cursor: '0', match: `${PREFIX}rules/*` },
    { cursor: '2', match: `${PREFIX}rules/*` },
  ])
})

test('Upstash credentials take precedence over a Workers KV binding', async () => {
  const upstash = useUpstash()
  const ns = new FakeKvNamespace()
  testGlobals.__testWorkersEnv = { KV: ns }
  const kv = loadBindings()

  await kv.kv_set_text('a', 'value')
  assert.equal(upstash.server.size, 1)
  assert.equal(ns.data.size, 0)
})

// --- Netlify Blobs ---

test('Netlify Blobs uses the versioned store and round-trips bytes and text', async () => {
  const netlify = useNetlify()
  const kv = loadBindings()

  await kv.kv_set('rules/a.list', bytes(1, 2, 3))
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
