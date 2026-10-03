# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## What this is

Rust rewrite of the C++ subconverter: converts proxy subscriptions between formats (Clash, Surge, sing-box, V2Ray, Quantumult X, Loon, etc.). One crate builds three ways:

1. **Native HTTP server / CLI** — binary `subconverter` (actix-web, port 25500). The binary requires the `web-api` feature; plain `cargo build` compiles only the library.
2. **Rust library** — `libsubconverter` (rlib).
3. **WASM package** — `@jat/subconverter-wasm` npm package (cdylib via wasm-pack, `--target nodejs`), consumed by the API of the web app in `www/` on Node platforms (Vercel and Netlify functions). The same package ships a Cloudflare Workers build at `@jat/subconverter-wasm/workers` (`--target web` into `pkg/workers/`, entry files in `wasm-host/workers/`), because Workers cannot compile WASM from bytes at runtime. The root export resolves to that build under the `workerd` condition, so `import '@jat/subconverter-wasm'` works on both; the `pkg/package.json` patch lives in `scripts/pkg-package.jq`, shared by the build scripts and the release workflow.

## Commands

```bash
# Build / run the server (web-api feature is required for the binary)
cargo build --release --features web-api
cargo run --features web-api                 # server on 127.0.0.1:25500

# One-shot conversion without a server (--url is a request URI, routed through the same handlers)
cargo run --features web-api -- --url "/sub?target=clash&url=..." -o output.yaml

# Tests (inline #[cfg(test)] modules; no tests/ directory)
cargo test
cargo test some_test_name                    # single test by name substring
cd wasm-host && pnpm test                    # TS host bindings: build src/ -> dist/, run node:test suite

# Type-check the wasm side (rustup target add wasm32-unknown-unknown first)
cargo check --target wasm32-unknown-unknown

# WASM dev build: wasm-pack build, rename to @jat/subconverter-wasm, copy into www/node_modules/
./scripts/build-wasm.sh                      # needs wasm-pack, jq, pnpm
./scripts/build-wasm.sh --optimize           # same with release-profile WASM (Workers deploys), no version changes

# Frontend (www/, Node >= 24, pnpm; never npx in pnpm projects, use pnpm exec / pnpm dlx)
cd www && pnpm install && pnpm dev           # SPA plus the API in Node (@hono/vite-dev-server)
pnpm rebuild:wasm:dev                        # rebuild wasm then start dev server
pnpm lint
pnpm exec tsc --noEmit
pnpm build                                   # the static SPA into dist/, the same for every platform
pnpm run start:workers                       # dist/ plus the API Worker locally in workerd (wrangler dev)
# Cloudflare Workers Builds (Git integration, root directory www) runs scripts/workers-build.sh: a full from-source
# build on every push, with the Rust toolchain/registry/target cached in the pnpm store (see www/README.md)
# Vercel builds every push on its Linux machines too: www/vercel.json runs scripts/vercel-install.sh (WASM from
# source, then pnpm install) before `vite build`; Netlify (base dir = repo root, package dir = www) runs
# scripts/netlify-build.sh; all three platform scripts share scripts/ci-toolchain.sh
# Settings that only exist in a platform dashboard are listed in www/README.md (Deployment); update that list
# whenever such a setting changes, and prefer moving a setting into wrangler.jsonc / vercel.json / netlify.toml
```

Optional cargo feature `js-runtime` (rquickjs, non-wasm only) enables JS scripting support; CI release builds use `--features=web-api,js-runtime`.

CI (`.github/workflows/test.yml`, on pushes to `main` and on PRs) runs `cargo fmt --check`, `cargo test`, `cargo check` for wasm32 and for the `js-runtime` feature (all with `RUSTFLAGS=-D warnings`), the wasm-host typecheck/tests (failing if the committed `wasm-host/dist/` is stale), and for `www/` a dev WASM build followed by `pnpm lint`, typecheck, `pnpm build` and a `wrangler deploy --dry-run` of the Worker.

## Release flow

Version in `Cargo.toml` drives everything; `www/package.json` pins the matching `@jat/subconverter-wasm` version. `./scripts/build-wasm.sh --bump-patch` bumps the version, commits, and pushes a `v{X.Y.Z}-attempt{N}` tag that triggers the GitHub Actions release (npm + crates.io + binaries). `--bump-beta` (non-main branch only) publishes an npm beta and deploys a Netlify preview. Both require a clean git tree.

## Architecture

The conversion pipeline is **parse → transform → generate**, orchestrated in `src/interfaces/subconverter.rs` (`SubconverterConfig` / `subconverter()`). Both the native web handlers and the WASM API funnel through this one entry point.

- `src/parser/` — input side. `explodes/` has one module per input format ("explode" = raw link/config text → `Proxy` structs): ss, ssr, vmess, vless, trojan, hysteria/hysteria2, wireguard, snell, anytls, surge, clash, etc. `subparser.rs::add_nodes` fetches subscription URLs and dispatches to the right explode. Clash YAML is parsed per-entry (one malformed node is skipped, not the whole subscription).
- `src/models/` — core domain types shared by both sides.
  - `proxy.rs` — `Proxy` carries only cross-protocol fields (endpoint, udp/tfo flags, the TLS block: `tls_secure`/`sni`/`alpn`/`fingerprint`/`client_fingerprint`). All protocol-specific data lives in `proxy_node/` structs under the `CombinedProxy` enum — each piece of information has exactly one home. Typed access via `as_vmess()`-style accessors plus cross-protocol view methods (`password()`, `host()`, `obfs()`, …).
  - `clash/` — the bidirectional Clash schema: one `Serialize + Deserialize` struct per protocol used for BOTH parsing and generation, so parse → emit roundtrips are lossless by construction (see the idempotence test in `clash/mod.rs`). `ClashProxyYamlInput` (parser) and `ClashProxyOutput` (generator) are aliases of this shared `ClashProxy` enum.
  - `target_profile.rs` — `ClashFlavor` (mihomo/premium/stash, chosen by the `flavor=` query param) and the `ClashCapabilities` matrix. `proxy_to_clash` consults it to drop unsupported protocols and strip unsupported fields per flavor. Client-version differences belong here, not in scattered conditionals.
- `src/generator/` — output side. `config/formats/` has one module per target (`proxy_to_surge`, `proxy_to_singbox`, …) plus `exports/proxy_to_clash.rs`; `ruleconvert/` converts rulesets between target formats. Emitters read protocol data only through the typed IR accessors.
  - `golden_tests.rs` + `testdata/*.golden` — golden output tests: a fixture with one node per supported protocol rendered through every emitter, byte-compared against checked-in files. Any output change shows up as a golden diff; update intentionally with `cargo test --lib regenerate_goldens -- --ignored`.
- `src/web_handlers/` (`web-api` feature) — actix-web endpoints (`/sub`, `/surge2clash`, …). `main.rs` starts the server; CLI direct mode routes a synthetic request through the same handlers via actix's test service.
- `src/api/` — WASM-facing `#[wasm_bindgen]` exports (sub, admin, rules, short_urls; mostly `cfg(target_arch = "wasm32")`).
- `src/vfs/` (wasm only) — virtual file system over Upstash Redis (Vercel KV) / Cloudflare Workers KV / Netlify Blobs through host bindings in `wasm-host/src/kv_bindings.ts` (TypeScript, compiled to `wasm-host/dist/kv_bindings.js`, which the `#[wasm_bindgen(module = ...)]` imports reference; dist is committed because wasm-bindgen reads it at compile time, so rebuild it with `pnpm build` after editing the source; npm deps declared in `wasm-host/package.json` are merged into the published package by the build scripts), with lazy loading of missing files from GitHub. In the WASM build, "file" reads for configs/rules go through this.
- `src/settings/` — global `Settings` singleton (`Settings::current()`); loads `pref.toml` → `pref.yml` → `pref.ini` in that priority order. `external/` handles the `&config=` external configs.
- `src/template/` — minijinja-based template rendering for base configs.
- `base/` — runtime data, not code: example prefs, base config templates, rules, snippets. The server reads these at runtime.
- `www/` — web app, deployed identically to Cloudflare Workers, Vercel and Netlify. `src/` is a React SPA (Vite, react-router, use-intl, Tailwind 4) that `vite build` emits as static files, served from each platform's CDN. `server/` is the API: one Hono app on the web standard `Request`/`Response` (`server/app.ts` mounts the handlers in `server/routes/`, which call `@jat/subconverter-wasm`), run through a few lines of platform entry — `server/worker.ts` (Workers; `wrangler.jsonc` hands only `/api/*` to it via `run_worker_first`, with the `KV` binding), `api/index.ts` (Vercel Function behind a `vercel.json` rewrite) and `netlify/functions/api.mts` (Netlify Function on `/api/*`). Keep platform specifics in those entries and configs, not in `server/`. `/api/admin/*` and short URL management (`/api/s` except the public `GET /api/s/[id]` redirect) require `Authorization: Bearer $ADMIN_TOKEN` (`www/server/admin-auth.ts`, a guard at the top of each handler; they are disabled when the variable is unset), and the browser side goes through `adminFetch()` in `www/src/lib/admin-token.ts`. API responses default to `Cache-Control: no-store` (middleware in `server/app.ts`) so neither CDNs nor Workers Cache store them; a handler sets its own header to allow caching.

### Dual-target constraint

Conditional compilation on `cfg(target_arch = "wasm32")` is pervasive: native uses awc + tokio for HTTP and real filesystem access; wasm uses web-sys fetch and the KV-backed VFS. When touching shared code (parser, generator, settings, utils), keep both targets compiling — check with `cargo check` and `cargo check --target wasm32-unknown-unknown`.
