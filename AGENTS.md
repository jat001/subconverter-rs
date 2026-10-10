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

# Tests (inline unit/golden tests plus integration tests in tests/)
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
pnpm test:routing                            # after build: dev/preview page, asset and HTTP 404 tests
netlify dev                                 # Vite plus Netlify Function/redirects/local Blobs at :8888
vercel dev                                  # Vite plus Vercel middleware at :3000 (first link and pull)
wrangler dev                                # dist/ plus the API Worker locally in workerd
# Wrangler is globally installed locally; it is not a www dependency. CI and Workers Builds use
# pnpx wrangler (pnpm's temporary CLI cache, without npm/npx).
# Netlify dev loads .env.local; Vercel's middleware uses Development variables downloaded by pull.
# Vercel CLI 63.1.0 on Windows loses the middleware POST body with both vite and null presets;
# use pnpm dev / netlify dev for complete local API debugging, and validate Vercel on previews.
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

## Repository hygiene

Keep one-off verification, diagnostic and migration scripts outside the repository. Commit only
scripts that belong to the maintained build, test or release workflows.

Before committing, format changed code using the project's existing formatting rules. Use readable
names, normal line breaks and explicit control-flow blocks; do not commit compressed scratch code.

## Release flow

When the user asks to "release" / "发版", prepare the release workflow, check missing configuration,
complete local verification, and write release notes for users. Obtain a separate, explicit final
confirmation before any publication. Do not infer approval from the initial release request or passing
checks. Before confirmation, do not push release-triggering tags, publish GitHub Releases or registry
packages, or push version/latest container tags. Finalize and verify the artifacts and release notes
before requesting confirmation. An explicit withdrawal request
authorizes withdrawing the named release.

Use this exact sequence for a release:

1. Start with a clean working tree and no pending code changes; commit existing authorized work first.
2. Finalize all code/documentation version numbers, lockfiles and user-facing release notes, then commit.
3. Run all local tests and validation. Fix failures and commit before proceeding.
4. Push code commits to main and require passing online CI for the exact final commit. Run the preparation-only workflow to check package artifacts, native archives and local container images.
5. Create the version tag locally at that verified commit. Never push it during preparation.
6. List the concrete publication operations and obtain the user's separate final confirmation.
7. Push that exact tag. CI automatically completes publication; make no further version/code/documentation edits after approval.

The tagged commit is the release source. User-facing README, changelog and package documents must not contain temporary "待发布", "候选", "pending confirmation" or similar placeholders. Internal execution records may describe their status.

`Cargo.toml` drives the version and `www/package.json` declares the matching WASM version. Only a version-tag push triggers publication. `wasm-release.yml` is the orchestrator: it builds/publishes the npm and crate packages, calls `release.yml` for eight native archives, calls `build-docker.yml` for amd64/arm64 images and manifests, and publishes the GitHub Release from CHANGELOG.md after all jobs succeed. Docker Hub uses `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`; GHCR uses the built-in GitHub token. Neither a Release event nor workflow_dispatch publishes anything.

Both registries use the configured GitHub OIDC trusted publishers for `jat001/subconverter-rs` and the exact filename `wasm-release.yml`. npm uses its CLI's OIDC authentication; crates.io uses `rust-lang/crates-io-auth-action` and its temporary token only during publication. The workflow verifies that the requested version matches the source, skips published versions on retries, and never writes back to main or creates tags. It needs no `NPM_TOKEN`, persistent `CARGO_REGISTRY_TOKEN`, or `PAT_TOKEN`. crates.io requires trusted publishing for new versions.

`scripts/build-wasm.sh` and `.ps1` only build local packages; they never mutate the source version, commit, tag, push or publish. `--release` / `-Release` and `--optimize` / `-Optimize` select the release compilation profile. The old automatic bump/beta/prepare-release options have been removed. Node remains on LTS 24.x with matching Node types.

Before final confirmation, manually run `wasm-release.yml` on the final commit with its version. This builds packages, performs publish dry-runs, builds native archives and tests local amd64/arm64 containers. OIDC authentication is part of publication, not a separate preflight check. Publication steps require both `github.event_name == 'push'` and a version-tag ref, including in reusable workflows. Manual runs cannot publish even when they select an existing tag. After confirmation, the only publication operation is pushing the already-created local tag.

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
- `www/` — web app, deployed identically to Cloudflare Workers, Vercel and Netlify. `src/` is a React SPA (Vite, react-router, use-intl, Tailwind 4) that `vite build` emits as static files, served from each platform's CDN. `server/` is the API: one Hono app on the web standard `Request`/`Response` (`server/app.ts` mounts the handlers in `server/routes/`, which call `@jat/subconverter-wasm`), run through a few lines of platform entry — `worker/index.ts` (Workers; `wrangler.jsonc` hands `/api/*` and explicit 404 URLs to it via `run_worker_first`, with `KV` and `ASSETS` bindings), `vercel/index.ts` (Vercel Node.js Routing Middleware selected by `proxy.entrypoint`, matching only `/api/*`) and `netlify/functions/index.mts` (Netlify Function on `/api/*`). Keep platform specifics in those entries and configs, not in `server/`. `/api/admin/*` and short URL management (`/api/s` except the public `GET /api/s/[id]` redirect) require `Authorization: Bearer $ADMIN_TOKEN` (`www/server/admin-auth.ts`, a guard at the top of each handler; they are disabled when the variable is unset), and the browser side goes through `adminFetch()` in `www/src/lib/admin-token.ts`. API responses default to `Cache-Control: no-store` (middleware in `server/app.ts`) so neither CDNs nor Workers Cache store them; a handler sets its own header to allow caching.

### Web routing

The web page paths live in `www/page-routes.ts`, shared by the client router and the static build plugin
(`www/build/static-pages.ts`). Every known path gets a directory `index.html`; `404.html` provides the
error response for unknown paths. Keep platform routing on native static 404 handling (Workers:
`404-page`; Vercel/Netlify: built-in `404.html`), without a catch-all rewrite to `/index.html`. The
client's wildcard page must stay outside `AppInitializer` so bad URLs do not redirect to startup.
Explicit `/404` and `/404.html` requests also need status overrides because the error page is a real
static file: Workers handles them through the `ASSETS` binding (fetch `/404`, not the redirecting
`/404.html`); Vercel uses clean URLs plus a status route; Netlify uses forced status rewrites. These
rules follow `jat001.com`'s tested handling. Ordinary page requests still stay on the CDN.

### Dual-target constraint

Conditional compilation on `cfg(target_arch = "wasm32")` is pervasive: native uses awc + tokio for HTTP and real filesystem access; wasm uses web-sys fetch and the KV-backed VFS. When touching shared code (parser, generator, settings, utils), keep both targets compiling — check with `cargo check` and `cargo check --target wasm32-unknown-unknown`.
