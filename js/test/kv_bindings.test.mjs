// Tests for the Upstash Redis adapter in kv_bindings.js.
// Run with `npm test` in js/ (node --test; module.registerHooks needs Node >= 22.15).
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { beforeEach, test } from 'node:test'

const require = createRequire(import.meta.url)
const BINDINGS_PATH = require.resolve('../kv_bindings.js')
const PREFIX = 'subconverter-data-v1'

// --- Fake @upstash/redis ---
// Mimics what the real client does to values (pkg/commands/command.ts and
// pkg/util.ts in @upstash/redis):
// - defaultSerializer passes strings, numbers and booleans through and
//   JSON.stringify's everything else, so a Uint8Array is stored as
//   '{"0":1,"1":2,...}';
// - replies are UTF-8 decoded, so invalid UTF-8 does not survive;
// - unless automaticDeserialization is false, replies go through
//   parseResponse, so "123" comes back as 123 and "{...}" as an object.
const server = new Map() // full key -> Buffer, what Redis holds

function defaultSerializer(value) {
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
      return value
    default:
      return JSON.stringify(value)
  }
}

function parseRecursive(obj) {
  const parsed = Array.isArray(obj)
    ? obj.map((o) => {
        try {
          return parseRecursive(o)
        } catch {
          return o
        }
      })
    : JSON.parse(obj)
  if (typeof parsed === 'number' && parsed.toString() !== obj) {
    return obj
  }
  return parsed
}

function parseResponse(result) {
  try {
    return parseRecursive(result)
  } catch {
    return result
  }
}

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

class FakeRedis {
  constructor(config) {
    this.automaticDeserialization = config.automaticDeserialization !== false
  }

  deserialize(result) {
    return this.automaticDeserialization ? parseResponse(result) : result
  }

  async get(key) {
    const stored = server.get(key)
    return this.deserialize(stored === undefined ? null : stored.toString())
  }

  async set(key, value) {
    server.set(key, Buffer.from(String(defaultSerializer(value))))
    return 'OK'
  }

  async exists(...keys) {
    return keys.filter((key) => server.has(key)).length
  }

  async del(...keys) {
    return keys.filter((key) => server.delete(key)).length
  }

  async scan(cursor, { match = '*', count = 10 } = {}) {
    const regex = globToRegExp(match)
    const matching = [...server.keys()].filter((key) => regex.test(key))
    const start = Number(cursor) || 0
    const end = Math.min(start + count, matching.length)
    const next = end < matching.length ? String(end) : '0'
    const result = [next, matching.slice(start, end)]
    // Like deserializeScanResponse: the cursor is left alone
    return this.automaticDeserialization
      ? [result[0], ...parseResponse(result.slice(1))]
      : result
  }
}

globalThis.__fakeUpstashRedis = { Redis: FakeRedis }
const FAKE_UPSTASH_URL = new URL(
  './__fake_upstash_redis__.cjs',
  import.meta.url,
).href
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
        source: 'module.exports = globalThis.__fakeUpstashRedis',
        shortCircuit: true,
      }
    }
    return nextLoad(url, context)
  },
})

// --- Helpers ---

process.env.KV_REST_API_URL = 'https://fake-upstash.example.com'
process.env.KV_REST_API_TOKEN = 'fake-token'

let kv

// Fresh module state, so getKv() builds a new client
function loadBindings() {
  delete require.cache[BINDINGS_PATH]
  return require(BINDINGS_PATH)
}

// Bindings backed by the in-memory fallback (no Upstash environment)
async function loadInMemoryBindings() {
  const { KV_REST_API_URL, KV_REST_API_TOKEN } = process.env
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  try {
    const bindings = loadBindings()
    await bindings.getKv()
    return bindings
  } finally {
    process.env.KV_REST_API_URL = KV_REST_API_URL
    process.env.KV_REST_API_TOKEN = KV_REST_API_TOKEN
  }
}

beforeEach(() => {
  server.clear()
  kv = loadBindings()
})

// Writes key the way the adapter did before values were encoded: through a
// client with default options.
async function writeLegacy(key, value) {
  await new FakeRedis({}).set(`${PREFIX}/${key}`, value)
}

const allByteValues = Uint8Array.from({ length: 256 }, (_, i) => i)

// --- Tests ---

test('bytes round-trip through kv_set and kv_get', async () => {
  const cases = {
    empty: new Uint8Array(0),
    all: allByteValues,
    invalidUtf8: Uint8Array.of(0xff, 0xfe, 0xc3, 0x28, 0x80),
    jsonLooking: new TextEncoder().encode('{"0":1}'),
    // Larger than one String.fromCharCode chunk
    large: Uint8Array.from({ length: 100_000 }, (_, i) => (i * 7) % 256),
  }
  for (const [name, bytes] of Object.entries(cases)) {
    await kv.kv_set(name, bytes)
    const value = await kv.kv_get(name)
    assert.ok(value instanceof Uint8Array, `${name}: not a Uint8Array`)
    assert.deepEqual(value, bytes, name)
  }
})

test('kv_set stores only the bytes a view covers', async () => {
  // wasm-bindgen passes &[u8] as a view into wasm memory
  const memory = Uint8Array.of(9, 9, 1, 2, 3, 9)
  await kv.kv_set('view', memory.subarray(2, 5))
  assert.deepEqual(await kv.kv_get('view'), Uint8Array.of(1, 2, 3))
})

test('text round-trips exactly through kv_set_text and kv_get_text', async () => {
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

test('kv_get and kv_get_text read values written by the other setter', async () => {
  const text = '{"rules":["DOMAIN,example.com"]}'
  await kv.kv_set('bytes', new TextEncoder().encode(text))
  await kv.kv_set_text('text', text)
  assert.equal(await kv.kv_get_text('bytes'), text)
  assert.deepEqual(await kv.kv_get('text'), new TextEncoder().encode(text))
})

test('missing keys read as undefined', async () => {
  assert.equal(await kv.kv_get('missing'), undefined)
  assert.equal(await kv.kv_get_text('missing'), undefined)
})

test('values written before the encoding change are still readable', async () => {
  // Bytes were JSON.stringify'd by the client: '{"0":0,"1":1,...}'
  await writeLegacy('legacy-bytes', allByteValues)
  await writeLegacy('legacy-empty', new Uint8Array(0))
  // Text was stored as-is
  const metadata = '{"files":{"a.yaml":{}},"directories":{}}'
  await writeLegacy('legacy-text', metadata)
  await writeLegacy('legacy-number', '123')

  assert.deepEqual(await kv.kv_get('legacy-bytes'), allByteValues)
  assert.deepEqual(await kv.kv_get('legacy-empty'), new Uint8Array(0))
  assert.equal(await kv.kv_get_text('legacy-text'), metadata)
  assert.equal(await kv.kv_get_text('legacy-number'), '123')
})

test('exists, list and del work on prefixed keys', async () => {
  await kv.kv_set('dir/a', Uint8Array.of(1))
  await kv.kv_set_text('dir/123', '123')
  await kv.kv_set_text('other', 'x')

  assert.equal(await kv.kv_exists('dir/a'), true)
  assert.equal(await kv.kv_exists('dir/b'), false)
  assert.deepEqual((await kv.kv_list('dir/')).sort(), ['dir/123', 'dir/a'])

  await kv.kv_del('dir/a')
  assert.equal(await kv.kv_exists('dir/a'), false)
  assert.equal(await kv.kv_get('dir/a'), undefined)
})

// wasm-bindgen passes &[u8] to JS imports as a view into wasm memory
// (memory.subarray): the view is detached if the memory grows, and Rust frees
// or reuses the memory once the call resolves.
for (const backend of ['upstash', 'in-memory']) {
  const load = backend === 'upstash' ? loadBindings : loadInMemoryBindings

  test(`kv_set keeps the bytes when wasm memory grows during the call (${backend})`, async () => {
    const bindings = await load()
    const memory = new WebAssembly.Memory({ initial: 1 })
    const view = new Uint8Array(memory.buffer, 16, 4)
    view.set([1, 2, 3, 4])

    const pending = bindings.kv_set('grow', view)
    memory.grow(1) // detaches view's buffer
    await pending

    assert.deepEqual(await bindings.kv_get('grow'), Uint8Array.of(1, 2, 3, 4))
  })

  test(`kv_set keeps the bytes when the caller's memory is reused afterwards (${backend})`, async () => {
    const bindings = await load()
    const memory = Uint8Array.of(1, 2, 3, 4)

    await bindings.kv_set('reuse', memory)
    memory.fill(0)

    assert.deepEqual(await bindings.kv_get('reuse'), Uint8Array.of(1, 2, 3, 4))
  })
}
