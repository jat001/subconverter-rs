// Tests for kv_bindings.js. Run with `npm test` (Node >= 22.15 for module.registerHooks).
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { afterEach, describe, test } from 'node:test'

const require = createRequire(import.meta.url)
const BINDINGS_PATH = require.resolve('../kv_bindings.js')

// --- Fake @upstash/redis ---
// kv_bindings.js does `require('@upstash/redis')` lazily inside getKv(). The hooks
// below route that specifier to a virtual module that re-exports FakeRedis.

const upstashStore = new Map()

class FakeRedis {
  constructor({ url, token }) {
    this.url = url
    this.token = token
  }

  async set(key, value) {
    // Snapshot at call time: the real SDK serializes command args synchronously.
    upstashStore.set(key, Uint8Array.from(value))
    return 'OK'
  }

  async get(key) {
    return upstashStore.get(key) ?? null
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

const ADAPTERS = [
  {
    name: 'Upstash Redis adapter',
    env: { KV_REST_API_URL: 'https://fake.upstash.io', KV_REST_API_TOKEN: 'test' },
    stored: (_bindings, key) =>
      upstashStore.get(`subconverter-data-v1/${key}`),
  },
  {
    name: 'in-memory fallback',
    env: {},
    stored: (bindings, key) => bindings.localStorageMap.get(key),
  },
]

const ORIGINAL = [1, 2, 3, 4, 5, 6, 7, 8]

// Mimics wasm-bindgen's getArrayU8FromWasm0: a subarray view into linear memory.
function wasmView(memory, ptr, bytes) {
  const view = new Uint8Array(memory.buffer).subarray(ptr, ptr + bytes.length)
  view.set(bytes)
  return view
}

// --- Tests ---

describe('kv_set copies the wasm memory view before awaiting', () => {
  afterEach(() => {
    upstashStore.clear()
    restoreEnv()
  })

  for (const adapter of ADAPTERS) {
    describe(adapter.name, () => {
      test('buffer mutated right after the call', async () => {
        const bindings = await loadBindings(adapter.env)
        const memory = new WebAssembly.Memory({ initial: 1 })
        const view = wasmView(memory, 64, ORIGINAL)

        const pending = bindings.kv_set('mutated', view)
        view.fill(0xff) // Rust reuses the memory before kv_set's await resumes
        await pending

        assert.deepEqual([...adapter.stored(bindings, 'mutated')], ORIGINAL)

        // The stored value must not alias wasm memory after the call either.
        new Uint8Array(memory.buffer).fill(0xee)
        assert.deepEqual([...adapter.stored(bindings, 'mutated')], ORIGINAL)
      })

      test('wasm memory grows during the await', async () => {
        const bindings = await loadBindings(adapter.env)
        const memory = new WebAssembly.Memory({ initial: 1 })
        const view = wasmView(memory, 64, ORIGINAL)

        const pending = bindings.kv_set('grown', view)
        memory.grow(1) // detaches the old buffer; the view's length drops to 0
        assert.equal(view.length, 0)
        await pending

        assert.deepEqual([...adapter.stored(bindings, 'grown')], ORIGINAL)
      })
    })
  }
})
