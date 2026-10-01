# wasm-host

Host-side code for the subconverter-rs WebAssembly package: what runs in JavaScript around the WASM module.

| Path | What it is |
| --- | --- |
| `src/kv_bindings.ts` | Bindings imported by the Rust code (`src/vfs/`, `src/utils/http_wasm.rs`): KV storage for the virtual file system, environment variable access, fetch helpers |
| `dist/kv_bindings.js` | Compiled output of the above. Committed, because wasm-bindgen reads it when the crate is compiled for `wasm32` (also from crates.io). Do not edit by hand |
| `workers/` | Cloudflare Workers entry, copied next to the `--target web` build in `pkg/workers/` and published as `@jat/subconverter-wasm/workers` |
| `package.json` | Runtime dependencies of the bindings; the build scripts merge them into the published `@jat/subconverter-wasm` package |

## Development

```bash
cd wasm-host
pnpm install
pnpm build       # src/ -> dist/ (commit the result)
pnpm typecheck
pnpm test        # builds, then runs the node:test suite against dist/
```

`scripts/build-wasm.sh` / `build-wasm.ps1` run `pnpm build` before wasm-pack, and the release workflow fails if the committed `dist/` does not match `src/`. Requires Node.js 24 and pnpm 12.

The tests run against the compiled `dist/kv_bindings.js` with Node's built-in test runner. The Workers runtime module (`cloudflare:workers`) and the storage clients (`@upstash/redis`, `@netlify/blobs`) are replaced with fakes through `module.registerHooks`, so every backend is covered without network access.

## Storage backends

The backend is picked on first use; the first one that is configured wins.

1. **Upstash Redis (Vercel KV)**: the standard variables `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or `KV_REST_API_URL` and `KV_REST_API_TOKEN` as set by the Vercel KV / Upstash integration.
2. **Cloudflare Workers KV**: a KV namespace bound as `KV` (`env.KV`) in `wrangler.jsonc`.
3. **Netlify Blobs**: detected from the Netlify runtime, no configuration needed.
4. **In-memory fallback**: local development; data does not persist.

Keys are stored under a `subconverter-data-v1/` prefix (Upstash, Workers KV), or in a `subconverter-data-v1` store (Netlify Blobs), so the storage can be shared with other data.

`kv_set` copies its bytes before the first `await`: wasm-bindgen passes `&[u8]` as a view into WASM memory, which is detached if the memory grows and reused by Rust once the call resolves.

### Upstash value format

`@upstash/redis` only stores strings: it `JSON.stringify`s anything else (a `Uint8Array` becomes `{"0":1,...}`) and by default `JSON.parse`s replies (`"123"` comes back as `123`). The client is therefore created with `automaticDeserialization: false`, and the adapter stores every value as a string:

- bytes as `subconverter:base64:` followed by base64;
- text as-is, or with `subconverter:text:` in front if it starts with one of these markers.

Values written before this format stay readable without a migration: text was stored as-is, and bytes as the JSON form of a `Uint8Array`, which `kv_get` still decodes.

### Cloudflare Workers KV

```jsonc
{
  "kv_namespaces": [
    { "binding": "KV", "id": "<namespace id>" }
  ]
}
```

The binding is read from `import { env } from 'cloudflare:workers'`, so no glue code is needed in the Worker. Outside the Workers runtime that import is unavailable and this backend is skipped. Workers KV is eventually consistent: writes can take up to about 60 seconds to be visible in other locations.

## Cloudflare Workers

The default `@jat/subconverter-wasm` entry is built with `wasm-pack --target nodejs`, which compiles the `.wasm` from bytes read with `fs` at load time. Workers do not allow that, so the package also ships a Workers build under `@jat/subconverter-wasm/workers` (`--target web`, entry in `workers/`). It imports the `.wasm` as a precompiled `WebAssembly.Module` through wrangler's default `*.wasm` rule and instantiates it on import, so no init call is needed:

```js
import { sub_process_wasm } from '@jat/subconverter-wasm/workers'

export default {
  async fetch(request) {
    const query = Object.fromEntries(new URL(request.url).searchParams)
    const result = JSON.parse(await sub_process_wasm(JSON.stringify(query)))
    return new Response(result.content, {
      status: result.status_code,
      headers: { 'Content-Type': result.content_type },
    })
  },
}
```

`wrangler.jsonc`:

```jsonc
{
  "main": "src/worker.js",
  "compatibility_date": "2025-09-01",
  // Required: the bundled storage clients (@netlify/blobs) import Node built-ins
  "compatibility_flags": ["nodejs_compat"],
  "kv_namespaces": [
    { "binding": "KV", "id": "<namespace id>" }
  ]
}
```

## Functions imported by Rust

- `kv_get(key)` / `kv_get_text(key)`: read a value as bytes / as a string
- `kv_set(key, value)` / `kv_set_text(key, value)`: store bytes / a string
- `kv_exists(key)`, `kv_list(prefix)`, `kv_del(key)`
- `getenv(name, default)`: environment variables (`std::env` does not work in WASM)
- `fetch_url`, `wasm_fetch_with_request`, `response_status`, `response_headers`, `response_text`, `response_bytes`: fetch helpers

All storage functions are async and normalize the backends' differences; bytes are `Uint8Array` in JavaScript and `&[u8]` in Rust.
