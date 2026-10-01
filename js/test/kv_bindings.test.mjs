// Tests for kv_bindings.js. Run with `npm test` (Node >= 22.15 for module.registerHooks).
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { afterEach, describe, test } from 'node:test'

const require = createRequire(import.meta.url)
const BINDINGS_PATH = require.resolve('../kv_bindings.js')

// --- Fake @upstash/redis ---
// kv_bindings.js does `require('@upstash/redis')` lazily inside getKv(). The hooks
// below route that specifier to a virtual module that re-exports FakeRedis.

// Server side: Redis values are strings.
const upstashStore = new Map()

// Mirrors @upstash/redis v1.39 defaultSerializer: anything but a string, number
// or boolean is JSON-stringified (a Uint8Array becomes '{"0":1,...}').
function serializeArg(value) {
  return ['string', 'number', 'boolean'].includes(typeof value)
    ? String(value)
    : JSON.stringify(value)
}

// Mirrors @upstash/redis v1.39 parseResponse, applied to replies unless the
// client was created with `automaticDeserialization: false`.
function parseReply(raw) {
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'number' && String(parsed) !== raw ? raw : parsed
  } catch {
    return raw
  }
}

class FakeRedis {
  constructor({ url, token, automaticDeserialization = true }) {
    this.url = url
    this.token = token
    this.automaticDeserialization = automaticDeserialization
  }

  // Args are serialized before the first await, as the real SDK builds the
  // command synchronously.
  async set(key, value) {
    upstashStore.set(key, serializeArg(value))
    return 'OK'
  }

  async get(key) {
    const raw = upstashStore.get(key) ?? null
    return raw !== null && this.automaticDeserialization ? parseReply(raw) : raw
  }

  async scan(cursor, { match = '*' } = {}) {
    // Redis rejects anything but an integer cursor.
    if (!/^\d+$/.test(String(cursor))) throw new Error('ERR invalid cursor')
    const pattern = match.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')
    const regex = new RegExp(`^${pattern}$`)
    return ['0', [...upstashStore.keys()].filter((k) => regex.test(k))]
  }
}

const FAKE_UPSTASH_URL = 'kv-bindings-test:@upstash/redis'
const FAKE_UPSTASH_KEY = Symbol.for('kv_bindings.test.FakeRedis')
globalThis[FAKE_UPSTASH_KEY] = FakeRedis

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@upstash/redis') {
      return { url: FAKE_UPSTASH_URL, format: 'commonjs', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === FAKE_UPSTASH_URL) {
      return {
        format: 'commonjs',
        source: `module.exports = { Redis: globalThis[Symbol.for(${JSON.stringify(FAKE_UPSTASH_KEY.description)})] }`,
        shortCircuit: true,
      }
    }
    return nextLoad(url, context)
  },
})

// --- Helpers ---

const ENV_KEYS = [
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'NETLIFY',
  'NETLIFY_BLOBS_CONTEXT',
]
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
}

// kv_bindings.js caches its adapter in module state, so load a fresh instance
// per test with only the given storage env vars set.
async function loadBindings(env = {}) {
  for (const k of ENV_KEYS) delete process.env[k]
  Object.assign(process.env, env)
  delete require.cache[BINDINGS_PATH]
  const bindings = require(BINDINGS_PATH)
  await bindings.getKv() // pick the adapter while env is set
  return bindings
}

const UPSTASH_ENV = {
  KV_REST_API_URL: 'https://fake.upstash.io',
  KV_REST_API_TOKEN: 'test',
}
const UPSTASH_PREFIX = 'subconverter-data-v1/'

const ADAPTERS = [
  { name: 'Upstash Redis adapter', env: UPSTASH_ENV },
  { name: 'in-memory fallback', env: {} },
]

const ORIGINAL = [1, 2, 3, 4, 5, 6, 7, 8]

// Mimics wasm-bindgen's getArrayU8FromWasm0: a subarray view into linear memory.
function wasmView(memory, ptr, bytes) {
  const view = new Uint8Array(memory.buffer).subarray(ptr, ptr + bytes.length)
  view.set(bytes)
  return view
}

afterEach(() => {
  upstashStore.clear()
  restoreEnv()
})

// --- Tests ---

describe('kv_set copies the wasm memory view before awaiting', () => {
  for (const adapter of ADAPTERS) {
    describe(adapter.name, () => {
      test('buffer mutated right after the call', async () => {
        const bindings = await loadBindings(adapter.env)
        const memory = new WebAssembly.Memory({ initial: 1 })
        const view = wasmView(memory, 64, ORIGINAL)

        const pending = bindings.kv_set('mutated', view)
        view.fill(0xff) // Rust reuses the memory before kv_set's await resumes
        await pending

        assert.deepEqual([...(await bindings.kv_get('mutated'))], ORIGINAL)

        // The stored value must not alias wasm memory after the call either.
        new Uint8Array(memory.buffer).fill(0xee)
        assert.deepEqual([...(await bindings.kv_get('mutated'))], ORIGINAL)
      })

      test('wasm memory grows during the await', async () => {
        const bindings = await loadBindings(adapter.env)
        const memory = new WebAssembly.Memory({ initial: 1 })
        const view = wasmView(memory, 64, ORIGINAL)

        const pending = bindings.kv_set('grown', view)
        memory.grow(1) // detaches the old buffer; the view's length drops to 0
        assert.equal(view.length, 0)
        await pending

        assert.deepEqual([...(await bindings.kv_get('grown'))], ORIGINAL)
      })
    })
  }
})

describe('Upstash adapter survives @upstash/redis serialization', () => {
  test('kv_set/kv_get round-trip non-UTF-8 bytes via base64', async () => {
    const bindings = await loadBindings(UPSTASH_ENV)
    const bytes = Uint8Array.of(0, 255, 128, 10, 0xc3)

    await bindings.kv_set('bin', bytes)

    assert.equal(
      upstashStore.get(`${UPSTASH_PREFIX}bin`),
      Buffer.from(bytes).toString('base64'),
    )
    assert.deepEqual([...(await bindings.kv_get('bin'))], [...bytes])
    assert.equal(await bindings.kv_get('missing'), undefined)
  })

  test('kv_get decodes values stored in the SDK JSON form', async () => {
    const bindings = await loadBindings(UPSTASH_ENV)
    // What kv_set stored before base64 encoding.
    upstashStore.set(
      `${UPSTASH_PREFIX}legacy`,
      serializeArg(Uint8Array.of(104, 105)),
    )

    assert.deepEqual([...(await bindings.kv_get('legacy'))], [104, 105])
  })

  test('kv_get_text returns JSON-looking text unparsed', async () => {
    const bindings = await loadBindings(UPSTASH_ENV)

    for (const text of ['{"files":{}}', '123', 'true', 'plain']) {
      await bindings.kv_set_text('text', text)
      assert.equal(await bindings.kv_get_text('text'), text)
    }
  })

  test('kv_list scans from cursor 0', async () => {
    const bindings = await loadBindings(UPSTASH_ENV)
    await bindings.kv_set('rules/a.list', Uint8Array.of(1))
    await bindings.kv_set_text('rules/.dir', '{}')
    await bindings.kv_set_text('other/b.list', 'b')

    assert.deepEqual((await bindings.kv_list('rules/')).sort(), [
      'rules/.dir',
      'rules/a.list',
    ])
  })
})
