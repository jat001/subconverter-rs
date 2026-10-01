"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.localStorageMap = void 0;
exports.getenv = getenv;
exports.getKv = getKv;
exports.kv_get = kv_get;
exports.kv_get_text = kv_get_text;
exports.kv_set = kv_set;
exports.kv_set_text = kv_set_text;
exports.kv_exists = kv_exists;
exports.kv_list = kv_list;
exports.kv_del = kv_del;
exports.fetch_url = fetch_url;
exports.response_status = response_status;
exports.response_bytes = response_bytes;
exports.wasm_fetch_with_request = wasm_fetch_with_request;
exports.response_headers = response_headers;
exports.response_text = response_text;
exports.dummy = dummy;
exports.migrateStorage = migrateStorage;
// --- Configuration ---
const CURRENT_STORAGE_VERSION = 1; // Increment this when making breaking changes
// Key prefix (Upstash, Workers KV) and store name (Netlify Blobs)
const STORAGE_PREFIX = `subconverter-data-v${CURRENT_STORAGE_VERSION}`;
// Binding name used throughout Cloudflare's examples: `env.KV`
const WORKERS_KV_BINDING = 'KV';
// Expose the in-memory store for debugging
exports.localStorageMap = new Map();
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
// Environment variable cache to avoid repeated lookups
const envCache = new Map();
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
// `process` may not exist at all (e.g. Cloudflare Workers without nodejs_compat)
function processEnv() {
    return typeof process !== 'undefined' ? process.env : undefined;
}
// Function to read environment variables from various runtimes
// This is needed because std::env::var doesn't work in WebAssembly
function getenv(name, defaultValue = '') {
    const cached = envCache.get(name);
    if (cached !== undefined) {
        return cached;
    }
    let value = defaultValue;
    try {
        const env = processEnv();
        if (env) {
            value = env[name] ?? defaultValue;
        }
        else {
            // Browsers: variables injected through window.__ENV__ (common pattern)
            const browserEnv = globalThis.window?.__ENV__;
            value = browserEnv?.[name] ?? defaultValue;
        }
    }
    catch (error) {
        console.warn(`Error reading environment variable ${name}:`, error);
    }
    envCache.set(name, value);
    return value;
}
// --- In-memory fallback (unversioned) ---
function createMemoryAdapter() {
    return {
        get: async (key) => exports.localStorageMap.get(key) ?? null,
        getText: async (key) => {
            const value = exports.localStorageMap.get(key);
            return typeof value === 'string' ? value : value && textDecoder.decode(value);
        },
        set: async (key, value) => {
            exports.localStorageMap.set(key, value);
        },
        setText: async (key, value) => {
            exports.localStorageMap.set(key, textEncoder.encode(value));
        },
        exists: async (key) => exports.localStorageMap.has(key),
        del: async (key) => {
            exports.localStorageMap.delete(key);
        },
        list: async (prefix) => [...exports.localStorageMap.keys()].filter((key) => key.startsWith(prefix)),
    };
}
// --- Upstash Redis (Vercel KV) ---
// Upstash's own variables, or the ones the Vercel KV / Upstash integration sets
function upstashCredentials() {
    const env = processEnv();
    const url = env?.UPSTASH_REDIS_REST_URL || env?.KV_REST_API_URL;
    const token = env?.UPSTASH_REDIS_REST_TOKEN || env?.KV_REST_API_TOKEN;
    return url && token ? { url, token } : null;
}
// Upstash value encoding. @upstash/redis JSON.stringify's non-string values on write (a Uint8Array
// becomes '{"0":1,"1":2,...}'), JSON.parse's replies by default ("123" -> 123, "{...}" -> object)
// and UTF-8 decodes every reply. So the client is created with automaticDeserialization: false and
// every value is stored as a string:
// - bytes as UPSTASH_BYTES_MARKER + base64;
// - text as-is, or with UPSTASH_TEXT_MARKER in front if it starts with a marker.
// Values written before this encoding stay readable without a migration: text was stored as-is,
// and bytes as the JSON of a Uint8Array (decodeLegacyBytes).
const UPSTASH_BYTES_MARKER = 'subconverter:base64:';
const UPSTASH_TEXT_MARKER = 'subconverter:text:';
function bytesToBase64(bytes) {
    let binary = '';
    // Chunked so String.fromCharCode doesn't exceed the argument limit
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}
function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
// The bytes of a value stored as JSON.stringify(Uint8Array), or undefined if raw is not in that form
function decodeLegacyBytes(raw) {
    if (!raw.startsWith('{')) {
        return undefined;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return undefined;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return undefined;
    }
    const values = parsed;
    const length = Object.keys(values).length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        const byte = values[i];
        if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
            return undefined;
        }
        bytes[i] = byte;
    }
    return bytes;
}
function encodeUpstashText(text) {
    return text.startsWith(UPSTASH_BYTES_MARKER) || text.startsWith(UPSTASH_TEXT_MARKER)
        ? UPSTASH_TEXT_MARKER + text
        : text;
}
function decodeUpstashBytes(raw) {
    if (raw.startsWith(UPSTASH_BYTES_MARKER)) {
        return base64ToBytes(raw.slice(UPSTASH_BYTES_MARKER.length));
    }
    if (raw.startsWith(UPSTASH_TEXT_MARKER)) {
        return textEncoder.encode(raw.slice(UPSTASH_TEXT_MARKER.length));
    }
    return decodeLegacyBytes(raw) ?? textEncoder.encode(raw);
}
function decodeUpstashText(raw) {
    if (raw.startsWith(UPSTASH_BYTES_MARKER)) {
        return textDecoder.decode(base64ToBytes(raw.slice(UPSTASH_BYTES_MARKER.length)));
    }
    if (raw.startsWith(UPSTASH_TEXT_MARKER)) {
        return raw.slice(UPSTASH_TEXT_MARKER.length);
    }
    return raw;
}
async function createUpstashAdapter(url, token) {
    const { Redis } = await import('@upstash/redis');
    // Values are encoded by the adapter (see UPSTASH_BYTES_MARKER)
    const redis = new Redis({ url, token, automaticDeserialization: false });
    const fullKey = (key) => `${STORAGE_PREFIX}/${key}`;
    const stripPrefix = (key) => key.startsWith(STORAGE_PREFIX + '/') ? key.substring(STORAGE_PREFIX.length + 1) : key;
    const getRaw = async (key) => {
        const raw = await redis.get(fullKey(key));
        return raw === null || raw === undefined ? undefined : String(raw);
    };
    return {
        get: async (key) => {
            const raw = await getRaw(key);
            return raw === undefined ? null : decodeUpstashBytes(raw);
        },
        getText: async (key) => {
            const raw = await getRaw(key);
            return raw === undefined ? undefined : decodeUpstashText(raw);
        },
        set: async (key, value) => {
            await redis.set(fullKey(key), UPSTASH_BYTES_MARKER + bytesToBase64(value));
        },
        setText: async (key, value) => {
            await redis.set(fullKey(key), encodeUpstashText(value));
        },
        exists: async (key) => (await redis.exists(fullKey(key))) > 0,
        del: async (key) => {
            await redis.del(fullKey(key));
        },
        list: async (prefix) => {
            const keys = [];
            let cursor = '0';
            do {
                const [next, page] = await redis.scan(cursor, {
                    match: `${fullKey(prefix)}*`,
                    count: 100,
                });
                cursor = String(next);
                keys.push(...page.map(stripPrefix));
            } while (cursor !== '0');
            return keys;
        },
    };
}
// --- Cloudflare Workers KV ---
function isKvNamespace(value) {
    const ns = value;
    return (typeof ns?.get === 'function' &&
        typeof ns.put === 'function' &&
        typeof ns.delete === 'function' &&
        typeof ns.list === 'function');
}
// Look up the `KV` namespace binding declared under kv_namespaces in wrangler.jsonc.
// Bindings are read from the `cloudflare:workers` env import, which only exists inside the
// Workers runtime; anywhere else the import fails and Workers KV is skipped.
async function findWorkersKvBinding() {
    let env;
    try {
        // Keep bundlers from trying to resolve the Workers-only module at build time
        ;
        ({ env } = await import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ 'cloudflare:workers'));
    }
    catch {
        return null;
    }
    const binding = env?.[WORKERS_KV_BINDING];
    return isKvNamespace(binding) ? binding : null;
}
// Keys are prefixed with the storage version so the namespace can be shared
function createWorkersKvAdapter(namespace) {
    const fullKey = (key) => `${STORAGE_PREFIX}/${key}`;
    const stripPrefix = (key) => key.startsWith(STORAGE_PREFIX + '/') ? key.substring(STORAGE_PREFIX.length + 1) : key;
    return {
        get: async (key) => {
            const value = await namespace.get(fullKey(key), { type: 'arrayBuffer' });
            return value === null ? null : new Uint8Array(value);
        },
        getText: async (key) => (await namespace.get(fullKey(key), { type: 'text' })) ?? undefined,
        set: async (key, value) => {
            await namespace.put(fullKey(key), value);
        },
        setText: async (key, value) => {
            await namespace.put(fullKey(key), value);
        },
        // Workers KV has no exists call; open the value as a stream and discard it without reading
        exists: async (key) => {
            const stream = await namespace.get(fullKey(key), { type: 'stream' });
            if (stream === null) {
                return false;
            }
            await stream.cancel();
            return true;
        },
        del: async (key) => {
            await namespace.delete(fullKey(key));
        },
        list: async (prefix) => {
            const keys = [];
            let cursor;
            do {
                const page = await namespace.list({ prefix: fullKey(prefix), cursor });
                keys.push(...page.keys.map((k) => stripPrefix(k.name)));
                cursor = page.list_complete ? undefined : page.cursor;
            } while (cursor);
            return keys;
        },
    };
}
// --- Netlify Blobs ---
function isNetlifyEnvironment() {
    const env = processEnv();
    if (!env) {
        return false;
    }
    return (env.NETLIFY === 'true' ||
        env.NETLIFY_BLOBS_CONTEXT !== undefined ||
        process.cwd?.() === '/var/task');
}
async function createNetlifyAdapter() {
    const { getStore } = await import('@netlify/blobs');
    const store = getStore(STORAGE_PREFIX);
    return {
        get: async (key) => {
            try {
                const value = (await store.get(key, { type: 'arrayBuffer' }));
                return value ? new Uint8Array(value) : null;
            }
            catch (error) {
                if (errorMessage(error).includes('not found')) {
                    return null;
                }
                throw error;
            }
        },
        getText: async (key) => (await store.get(key, { type: 'text' })) ?? undefined,
        // The copy from kv_set owns its whole buffer, so the buffer holds exactly these bytes
        set: async (key, value) => {
            await store.set(key, value.buffer);
        },
        setText: async (key, value) => {
            await store.set(key, value);
        },
        exists: async (key) => {
            try {
                return Boolean(await store.getMetadata(key));
            }
            catch {
                return false;
            }
        },
        del: async (key) => {
            await store.delete(key);
        },
        list: async (prefix) => (await store.list({ prefix })).blobs.map((blob) => blob.key),
    };
}
// --- Backend selection ---
async function selectAdapter() {
    try {
        const upstash = upstashCredentials();
        if (upstash) {
            const adapter = await createUpstashAdapter(upstash.url, upstash.token);
            console.log(`Using Upstash Redis for storage (version prefix: ${STORAGE_PREFIX})`);
            return adapter;
        }
        const namespace = await findWorkersKvBinding();
        if (namespace) {
            console.log(`Using Cloudflare Workers KV binding ${WORKERS_KV_BINDING} for storage (version prefix: ${STORAGE_PREFIX})`);
            return createWorkersKvAdapter(namespace);
        }
        if (isNetlifyEnvironment()) {
            const adapter = await createNetlifyAdapter();
            console.log(`Using Netlify Blobs for storage (store: ${STORAGE_PREFIX})`);
            return adapter;
        }
        console.log('No KV storage environment detected, using in-memory fallback (unversioned)');
    }
    catch (error) {
        console.warn('Error initializing storage, using in-memory fallback (unversioned):', error);
    }
    return createMemoryAdapter();
}
let kvPromise;
// Selected once, on first use
function getKv() {
    kvPromise ??= selectAdapter();
    return kvPromise;
}
// --- Storage functions imported by Rust ---
// Bytes as Uint8Array; some backends may return strings for values stored as text
async function kv_get(key) {
    try {
        const value = await (await getKv()).get(key);
        if (value instanceof ArrayBuffer) {
            return new Uint8Array(value);
        }
        return value ?? undefined;
    }
    catch (error) {
        console.error(`KV get error for ${key}:`, error);
        throw new Error(`Failed to get key ${key}: ${errorMessage(error)}`);
    }
}
async function kv_get_text(key) {
    try {
        return await (await getKv()).getText(key);
    }
    catch (error) {
        if (errorMessage(error).includes('not found')) {
            console.debug(`KV get_text: Key ${key} not found.`);
            return undefined;
        }
        console.error(`KV get_text error for ${key}:`, error);
        throw new Error(`Failed to get text for key ${key}: ${errorMessage(error)}`);
    }
}
async function kv_set(key, value) {
    // wasm-bindgen passes &[u8] as a view into WASM memory, valid only synchronously: memory growth
    // during an await detaches it, and Rust reuses the memory once this call resolves. Copy before
    // the first await. (`new Uint8Array(view)` always copies; Buffer#slice would return a view.)
    const bytes = new Uint8Array(value);
    try {
        await (await getKv()).set(key, bytes);
    }
    catch (error) {
        console.error(`KV set error for ${key}:`, error);
        throw new Error(`Failed to set key ${key}: ${errorMessage(error)}`);
    }
}
async function kv_set_text(key, value) {
    try {
        await (await getKv()).setText(key, value);
    }
    catch (error) {
        console.error(`KV set_text error for ${key}:`, error);
        throw new Error(`Failed to set text for key ${key}: ${errorMessage(error)}`);
    }
}
async function kv_exists(key) {
    try {
        return await (await getKv()).exists(key);
    }
    catch (error) {
        console.error(`KV exists error for ${key}:`, error);
        return false;
    }
}
async function kv_list(prefix) {
    try {
        return await (await getKv()).list(prefix);
    }
    catch (error) {
        console.error(`KV list error for prefix ${prefix}:`, error);
        return [];
    }
}
async function kv_del(key) {
    try {
        await (await getKv()).del(key);
    }
    catch (error) {
        console.error(`KV del error for ${key}:`, error);
    }
}
// --- Fetch helpers imported by Rust ---
function assertResponse(response) {
    if (!(response instanceof Response)) {
        throw new TypeError('Input is not a Response object');
    }
}
// Use global fetch available in Edge runtime
async function fetch_url(url) {
    try {
        return await fetch(url);
    }
    catch (error) {
        console.error(`Fetch error for ${url}:`, error);
        throw error;
    }
}
async function response_status(response) {
    assertResponse(response);
    return response.status;
}
async function response_bytes(response) {
    assertResponse(response);
    try {
        return new Uint8Array(await response.arrayBuffer());
    }
    catch (error) {
        console.error(`Error reading response body:`, error);
        throw error;
    }
}
// fetch() with the request options built on the Rust side
async function wasm_fetch_with_request(url, options) {
    try {
        if (typeof fetch === 'undefined') {
            throw new Error('No fetch implementation available');
        }
        return await fetch(url, {
            method: options?.method || 'GET',
            headers: { ...options?.headers },
            body: options?.body || undefined,
        });
    }
    catch (error) {
        console.error(`WASM fetch error for ${url}:`, error);
        throw error;
    }
}
async function response_headers(response) {
    assertResponse(response);
    return Object.fromEntries(response.headers.entries());
}
async function response_text(response) {
    assertResponse(response);
    return await response.text();
}
function dummy() {
    return 'dummy';
}
// --- Migration Placeholder ---
/**
 * Migrates data from an old storage version to the current version.
 * This is a placeholder and needs to be implemented when a migration is required.
 *
 * @param oldVersion The version detected in storage.
 * @param newVersion The current storage version defined in the code.
 */
async function migrateStorage(oldVersion, newVersion) {
    console.warn(`Storage migration needed from v${oldVersion} to v${newVersion}. Migration logic not implemented yet.`);
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
