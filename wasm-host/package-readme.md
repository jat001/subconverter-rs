# @jat/subconverter-wasm

Convert proxy subscriptions with the subconverter-rs Rust engine, compiled to WebAssembly for Node.js and Cloudflare Workers. Use Node.js 24 LTS for the Node build.

## Install

```sh
pnpm add @jat/subconverter-wasm
```

## Node.js

```js
import {
  initialize_subconverter_webapp,
  sub_process_wasm,
} from '@jat/subconverter-wasm'

// Initializes the virtual filesystem and loads the default configuration from GitHub when needed.
await initialize_subconverter_webapp()

const result = JSON.parse(await sub_process_wasm(JSON.stringify({
  target: 'clash',
  url: 'ss://YWVzLTEyOC1nY206ZXhhbXBsZQ==@example.com:443#example-node',
  list: true,
})))

if (result.status_code !== 200) throw new Error(result.content)
console.log(result.content)
```

The link above is sample data, not a working proxy. Replace it with your subscription URL or proxy links. Conversion parameters follow the project's `/sub` API. The return value is a JSON string containing `status_code`, `content_type`, `headers` and `content`.

## Cloudflare Workers

```js
import { sub_process_wasm } from '@jat/subconverter-wasm/workers'

export default {
  async fetch(request) {
    const query = Object.fromEntries(new URL(request.url).searchParams)
    const result = JSON.parse(await sub_process_wasm(JSON.stringify(query)))
    return new Response(result.content, {
      status: result.status_code,
      headers: { 'Content-Type': result.content_type, ...result.headers },
    })
  },
}
```

The Workers entry instantiates the precompiled WASM module on import. Bind a KV namespace as `KV` in `wrangler.jsonc` to persist configuration and short links. The package's root export also selects this entry in bundlers that use the `workerd` condition.

## Storage and configuration

The JavaScript bindings select the first configured backend:

1. Upstash Redis: `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, or `KV_REST_API_URL` / `KV_REST_API_TOKEN`.
2. Workers KV: the `KV` namespace binding.
3. Netlify Blobs: detected in the Netlify runtime.
4. In-memory storage: used when no persistent backend is configured; data is lost when the process or isolate exits.

Missing configuration files are loaded from `jat001/subconverter-rs` on GitHub. An optional `GITHUB_TOKEN` authenticates those reads. The package also exports virtual filesystem, rule update and short-link APIs; see the included `.d.ts` definitions.

For the full web application and deployment instructions, see the [repository](https://github.com/jat001/subconverter-rs) and [web deployment guide](https://github.com/jat001/subconverter-rs/blob/main/www/README.md).

License: GPL-3.0-or-later.
