// Host-side bindings imported by the Rust code (src/vfs/, src/utils/http_wasm.rs): key-value storage
// for the WASM virtual file system, environment variable access and fetch helpers.
//
// Storage backends, first match wins:
//   1. Upstash Redis (Vercel KV)  UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN
//   2. Cloudflare Workers KV      `KV` binding under kv_namespaces in wrangler.jsonc
//   3. Netlify Blobs              detected from the Netlify runtime
//   4. In-memory fallback         local development
//
// Compiled to dist/kv_bindings.js with `pnpm build` in wasm-host/. The compiled file is committed
// because wasm-bindgen reads it when the crate is compiled for wasm32; edit this source, not dist/.

// --- Configuration ---
const CURRENT_STORAGE_VERSION = 1 // Increment this when making breaking changes
// Key prefix (Upstash, Workers KV) and store name (Netlify Blobs)
const STORAGE_PREFIX = `subconverter-data-v${CURRENT_STORAGE_VERSION}`
// Binding name used throughout Cloudflare's examples: `env.KV`
const WORKERS_KV_BINDING = 'KV'

// ---------------------

// One implementation per storage backend; the kv_* exports below delegate to the selected one
export interface KvAdapter {
  get(key: string): Promise<unknown>
  getText(key: string): Promise<string | undefined>
  /** `value` is a copy owned by the adapter (kv_set makes it), so it may be kept as-is */
  set(key: string, value: Uint8Array<ArrayBuffer>): Promise<void>
  setText(key: string, value: string): Promise<void>
  exists(key: string): Promise<boolean>
  del(key: string): Promise<void>
  list(prefix: string): Promise<string[]>
}

// The subset of the Workers KVNamespace API used here
interface KvNamespace {
  get(key: string, options: { type: 'text' }): Promise<string | null>
  get(key: string, options: { type: 'arrayBuffer' }): Promise<ArrayBuffer | null>
  get(key: string, options: { type: 'stream' }): Promise<ReadableStream | null>
  put(key: string, value: string | ArrayBuffer | ArrayBufferView): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string; cursor?: string }): Promise<{
    keys: { name: string }[]
    list_complete: boolean
    cursor?: string
  }>
}

// Expose the in-memory store for debugging
export const localStorageMap = new Map<string, Uint8Array | string>()

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

// Environment variable cache to avoid repeated lookups
const envCache = new Map<string, string>()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// `process` may not exist at all (e.g. Cloudflare Workers without nodejs_compat)
function processEnv(): NodeJS.ProcessEnv | undefined {
  return typeof process !== 'undefined' ? process.env : undefined
}

// Function to read environment variables from various runtimes
// This is needed because std::env::var doesn't work in WebAssembly
export function getenv(name: string, defaultValue = ''): string {
  const cached = envCache.get(name)
  if (cached !== undefined) {
    return cached
  }

  let value = defaultValue
  try {
    const env = processEnv()
    if (env) {
      value = env[name] ?? defaultValue
    } else {
      // Browsers: variables injected through window.__ENV__ (common pattern)
      const browserEnv = (
        globalThis as { window?: { __ENV__?: Record<string, string> } }
      ).window?.__ENV__
      value = browserEnv?.[name] ?? defaultValue
    }
  } catch (error) {
    console.warn(`Error reading environment variable ${name}:`, error)
  }

  envCache.set(name, value)
  return value
}

// --- In-memory fallback (unversioned) ---

function createMemoryAdapter(): KvAdapter {
  return {
    get: async (key) => localStorageMap.get(key) ?? null,
    getText: async (key) => {
      const value = localStorageMap.get(key)
      return typeof value === 'string' ? value : value && textDecoder.decode(value)
    },
    set: async (key, value) => {
      localStorageMap.set(key, value)
    },
    setText: async (key, value) => {
      localStorageMap.set(key, textEncoder.encode(value))
    },
    exists: async (key) => localStorageMap.has(key),
    del: async (key) => {
      localStorageMap.delete(key)
    },
    list: async (prefix) =>
      [...localStorageMap.keys()].filter((key) => key.startsWith(prefix)),
  }
}

// --- Upstash Redis (Vercel KV) ---

// Upstash's own variables, or the ones the Vercel KV / Upstash integration sets
function upstashCredentials(): { url: string; token: string } | null {
  const env = processEnv()
  const url = env?.UPSTASH_REDIS_REST_URL || env?.KV_REST_API_URL
  const token = env?.UPSTASH_REDIS_REST_TOKEN || env?.KV_REST_API_TOKEN
  return url && token ? { url, token } : null
}

// Upstash value encoding. @upstash/redis JSON.stringify's non-string values on write (a Uint8Array
// becomes '{"0":1,"1":2,...}'), JSON.parse's replies by default ("123" -> 123, "{...}" -> object)
// and UTF-8 decodes every reply. So the client is created with automaticDeserialization: false and
// every value is stored as a string:
// - bytes as UPSTASH_BYTES_MARKER + base64;
// - text as-is, or with UPSTASH_TEXT_MARKER in front if it starts with a marker.
// Values written before this encoding stay readable without a migration: text was stored as-is,
// and bytes as the JSON of a Uint8Array (decodeLegacyBytes).
const UPSTASH_BYTES_MARKER = 'subconverter:base64:'
const UPSTASH_TEXT_MARKER = 'subconverter:text:'

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  // Chunked so String.fromCharCode doesn't exceed the argument limit
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// The bytes of a value stored as JSON.stringify(Uint8Array), or undefined if raw is not in that form
function decodeLegacyBytes(raw: string): Uint8Array | undefined {
  if (!raw.startsWith('{')) {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined
  }
  const values = parsed as Record<string, unknown>
  const length = Object.keys(values).length
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    const byte = values[i]
    if (!Number.isInteger(byte) || (byte as number) < 0 || (byte as number) > 255) {
      return undefined
    }
    bytes[i] = byte as number
  }
  return bytes
}

function encodeUpstashText(text: string): string {
  return text.startsWith(UPSTASH_BYTES_MARKER) || text.startsWith(UPSTASH_TEXT_MARKER)
    ? UPSTASH_TEXT_MARKER + text
    : text
}

function decodeUpstashBytes(raw: string): Uint8Array {
  if (raw.startsWith(UPSTASH_BYTES_MARKER)) {
    return base64ToBytes(raw.slice(UPSTASH_BYTES_MARKER.length))
  }
  if (raw.startsWith(UPSTASH_TEXT_MARKER)) {
    return textEncoder.encode(raw.slice(UPSTASH_TEXT_MARKER.length))
  }
  return decodeLegacyBytes(raw) ?? textEncoder.encode(raw)
}

function decodeUpstashText(raw: string): string {
  if (raw.startsWith(UPSTASH_BYTES_MARKER)) {
    return textDecoder.decode(base64ToBytes(raw.slice(UPSTASH_BYTES_MARKER.length)))
  }
  if (raw.startsWith(UPSTASH_TEXT_MARKER)) {
    return raw.slice(UPSTASH_TEXT_MARKER.length)
  }
  return raw
}

async function createUpstashAdapter(url: string, token: string): Promise<KvAdapter> {
  const { Redis } = await import('@upstash/redis')
  // Values are encoded by the adapter (see UPSTASH_BYTES_MARKER)
  const redis = new Redis({ url, token, automaticDeserialization: false })
  const fullKey = (key: string) => `${STORAGE_PREFIX}/${key}`
  const stripPrefix = (key: string) =>
    key.startsWith(STORAGE_PREFIX + '/') ? key.substring(STORAGE_PREFIX.length + 1) : key
  const getRaw = async (key: string) => {
    const raw = await redis.get<string>(fullKey(key))
    return raw === null || raw === undefined ? undefined : String(raw)
  }

  return {
    get: async (key) => {
      const raw = await getRaw(key)
      return raw === undefined ? null : decodeUpstashBytes(raw)
    },
    getText: async (key) => {
      const raw = await getRaw(key)
      return raw === undefined ? undefined : decodeUpstashText(raw)
    },
    set: async (key, value) => {
      await redis.set(fullKey(key), UPSTASH_BYTES_MARKER + bytesToBase64(value))
    },
    setText: async (key, value) => {
      await redis.set(fullKey(key), encodeUpstashText(value))
    },
    exists: async (key) => (await redis.exists(fullKey(key))) > 0,
    del: async (key) => {
      await redis.del(fullKey(key))
    },
    list: async (prefix) => {
      const keys: string[] = []
      let cursor = '0'
      do {
        const [next, page] = await redis.scan(cursor, {
          match: `${fullKey(prefix)}*`,
          count: 100,
        })
        cursor = String(next)
        keys.push(...page.map(stripPrefix))
      } while (cursor !== '0')
      return keys
    },
  }
}

// --- Cloudflare Workers KV ---

function isKvNamespace(value: unknown): value is KvNamespace {
  const ns = value as Partial<Record<keyof KvNamespace, unknown>> | null | undefined
  return (
    typeof ns?.get === 'function' &&
    typeof ns.put === 'function' &&
    typeof ns.delete === 'function' &&
    typeof ns.list === 'function'
  )
}

// Look up the `KV` namespace binding declared under kv_namespaces in wrangler.jsonc.
// Bindings are read from the `cloudflare:workers` env import, which only exists inside the
// Workers runtime; anywhere else the import fails and Workers KV is skipped.
async function findWorkersKvBinding(): Promise<KvNamespace | null> {
  let env: Record<string, unknown> | undefined
  try {
    // Keep bundlers from trying to resolve the Workers-only module at build time
    ;({ env } = await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ 'cloudflare:workers'
    ))
  } catch {
    return null
  }
  const binding = env?.[WORKERS_KV_BINDING]
  return isKvNamespace(binding) ? binding : null
}

// Keys are prefixed with the storage version so the namespace can be shared
function createWorkersKvAdapter(namespace: KvNamespace): KvAdapter {
  const fullKey = (key: string) => `${STORAGE_PREFIX}/${key}`
  const stripPrefix = (key: string) =>
    key.startsWith(STORAGE_PREFIX + '/') ? key.substring(STORAGE_PREFIX.length + 1) : key

  return {
    get: async (key) => {
      const value = await namespace.get(fullKey(key), { type: 'arrayBuffer' })
      return value === null ? null : new Uint8Array(value)
    },
    getText: async (key) =>
      (await namespace.get(fullKey(key), { type: 'text' })) ?? undefined,
    set: async (key, value) => {
      await namespace.put(fullKey(key), value)
    },
    setText: async (key, value) => {
      await namespace.put(fullKey(key), value)
    },
    // Workers KV has no exists call; open the value as a stream and discard it without reading
    exists: async (key) => {
      const stream = await namespace.get(fullKey(key), { type: 'stream' })
      if (stream === null) {
        return false
      }
      await stream.cancel()
      return true
    },
    del: async (key) => {
      await namespace.delete(fullKey(key))
    },
    list: async (prefix) => {
      const keys: string[] = []
      let cursor: string | undefined
      do {
        const page = await namespace.list({ prefix: fullKey(prefix), cursor })
        keys.push(...page.keys.map((k) => stripPrefix(k.name)))
        cursor = page.list_complete ? undefined : page.cursor
      } while (cursor)
      return keys
    },
  }
}

// --- Netlify Blobs ---

function isNetlifyEnvironment(): boolean {
  const env = processEnv()
  if (!env) {
    return false
  }
  return (
    env.NETLIFY === 'true' ||
    env.NETLIFY_BLOBS_CONTEXT !== undefined ||
    process.cwd?.() === '/var/task'
  )
}

async function createNetlifyAdapter(): Promise<KvAdapter> {
  const { getStore } = await import('@netlify/blobs')
  const store = getStore(STORAGE_PREFIX)

  return {
    get: async (key) => {
      try {
        const value = (await store.get(key, { type: 'arrayBuffer' })) as ArrayBuffer | null
        return value ? new Uint8Array(value) : null
      } catch (error) {
        if (errorMessage(error).includes('not found')) {
          return null
        }
        throw error
      }
    },
    getText: async (key) => (await store.get(key, { type: 'text' })) ?? undefined,
    // The copy from kv_set owns its whole buffer, so the buffer holds exactly these bytes
    set: async (key, value) => {
      await store.set(key, value.buffer)
    },
    setText: async (key, value) => {
      await store.set(key, value)
    },
    exists: async (key) => {
      try {
        return Boolean(await store.getMetadata(key))
      } catch {
        return false
      }
    },
    del: async (key) => {
      await store.delete(key)
    },
    list: async (prefix) => (await store.list({ prefix })).blobs.map((blob) => blob.key),
  }
}

// --- Backend selection ---

async function selectAdapter(): Promise<KvAdapter> {
  try {
    const upstash = upstashCredentials()
    if (upstash) {
      const adapter = await createUpstashAdapter(upstash.url, upstash.token)
      console.log(`Using Upstash Redis for storage (version prefix: ${STORAGE_PREFIX})`)
      return adapter
    }

    const namespace = await findWorkersKvBinding()
    if (namespace) {
      console.log(
        `Using Cloudflare Workers KV binding ${WORKERS_KV_BINDING} for storage (version prefix: ${STORAGE_PREFIX})`,
      )
      return createWorkersKvAdapter(namespace)
    }

    if (isNetlifyEnvironment()) {
      const adapter = await createNetlifyAdapter()
      console.log(`Using Netlify Blobs for storage (store: ${STORAGE_PREFIX})`)
      return adapter
    }

    console.log('No KV storage environment detected, using in-memory fallback (unversioned)')
  } catch (error) {
    console.warn('Error initializing storage, using in-memory fallback (unversioned):', error)
  }
  return createMemoryAdapter()
}

let kvPromise: Promise<KvAdapter> | undefined

// Selected once, on first use
export function getKv(): Promise<KvAdapter> {
  kvPromise ??= selectAdapter()
  return kvPromise
}

// --- Storage functions imported by Rust ---

// Bytes as Uint8Array; some backends may return strings for values stored as text
export async function kv_get(key: string): Promise<unknown> {
  try {
    const value = await (await getKv()).get(key)
    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value)
    }
    return value ?? undefined
  } catch (error) {
    console.error(`KV get error for ${key}:`, error)
    throw new Error(`Failed to get key ${key}: ${errorMessage(error)}`)
  }
}

export async function kv_get_text(key: string): Promise<string | undefined> {
  try {
    return await (await getKv()).getText(key)
  } catch (error) {
    if (errorMessage(error).includes('not found')) {
      console.debug(`KV get_text: Key ${key} not found.`)
      return undefined
    }
    console.error(`KV get_text error for ${key}:`, error)
    throw new Error(`Failed to get text for key ${key}: ${errorMessage(error)}`)
  }
}

export async function kv_set(key: string, value: Uint8Array): Promise<void> {
  // wasm-bindgen passes &[u8] as a view into WASM memory, valid only synchronously: memory growth
  // during an await detaches it, and Rust reuses the memory once this call resolves. Copy before
  // the first await. (`new Uint8Array(view)` always copies; Buffer#slice would return a view.)
  const bytes = new Uint8Array(value)
  try {
    await (await getKv()).set(key, bytes)
  } catch (error) {
    console.error(`KV set error for ${key}:`, error)
    throw new Error(`Failed to set key ${key}: ${errorMessage(error)}`)
  }
}

export async function kv_set_text(key: string, value: string): Promise<void> {
  try {
    await (await getKv()).setText(key, value)
  } catch (error) {
    console.error(`KV set_text error for ${key}:`, error)
    throw new Error(`Failed to set text for key ${key}: ${errorMessage(error)}`)
  }
}

export async function kv_exists(key: string): Promise<boolean> {
  try {
    return await (await getKv()).exists(key)
  } catch (error) {
    console.error(`KV exists error for ${key}:`, error)
    return false
  }
}

export async function kv_list(prefix: string): Promise<string[]> {
  try {
    return await (await getKv()).list(prefix)
  } catch (error) {
    console.error(`KV list error for prefix ${prefix}:`, error)
    return []
  }
}

export async function kv_del(key: string): Promise<void> {
  try {
    await (await getKv()).del(key)
  } catch (error) {
    console.error(`KV del error for ${key}:`, error)
  }
}

// --- Fetch helpers imported by Rust ---

function assertResponse(response: unknown): asserts response is Response {
  if (!(response instanceof Response)) {
    throw new TypeError('Input is not a Response object')
  }
}

// Use global fetch available in Edge runtime
export async function fetch_url(url: string): Promise<Response> {
  try {
    return await fetch(url)
  } catch (error) {
    console.error(`Fetch error for ${url}:`, error)
    throw error
  }
}

export async function response_status(response: unknown): Promise<number> {
  assertResponse(response)
  return response.status
}

export async function response_bytes(response: unknown): Promise<Uint8Array> {
  assertResponse(response)
  try {
    return new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    console.error(`Error reading response body:`, error)
    throw error
  }
}

interface WasmFetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: RequestInit['body']
}

// fetch() with the request options built on the Rust side
export async function wasm_fetch_with_request(
  url: string,
  options?: WasmFetchOptions,
): Promise<Response> {
  try {
    if (typeof fetch === 'undefined') {
      throw new Error('No fetch implementation available')
    }
    return await fetch(url, {
      method: options?.method || 'GET',
      headers: { ...options?.headers },
      body: options?.body || undefined,
    })
  } catch (error) {
    console.error(`WASM fetch error for ${url}:`, error)
    throw error
  }
}

export async function response_headers(response: unknown): Promise<Record<string, string>> {
  assertResponse(response)
  return Object.fromEntries(response.headers.entries())
}

export async function response_text(response: unknown): Promise<string> {
  assertResponse(response)
  return await response.text()
}

export function dummy(): string {
  return 'dummy'
}

// --- Migration Placeholder ---

/**
 * Migrates data from an old storage version to the current version.
 * This is a placeholder and needs to be implemented when a migration is required.
 *
 * @param oldVersion The version detected in storage.
 * @param newVersion The current storage version defined in the code.
 */
export async function migrateStorage(oldVersion: number, newVersion: number): Promise<void> {
  console.warn(
    `Storage migration needed from v${oldVersion} to v${newVersion}. Migration logic not implemented yet.`,
  )
  // Example steps:
  // 1. Get access to the old version's store/client (e.g., using getStore(`...v${oldVersion}`))
  // 2. List keys from the old store.
  // 3. For each key/value:
  //    a. Read from old store.
  //    b. Transform data if necessary.
  //    c. Write to the *new* version's store (using the main `getKv()` which points to the new version).
  //    d. Optionally, delete from the old store after successful migration.
  // 4. Handle errors carefully.
  // 5. Update the storage version marker only after successful migration.
}
