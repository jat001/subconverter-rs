# Subconverter Web UI

A modern web UI for the subconverter-rs project. This project allows you to convert proxy subscriptions to
various formats and create shareable links with custom configurations.

## Features

- Convert proxy subscriptions to different formats (Clash, Surge, Quantumult X, etc.)
- Create and save custom configurations
- Generate shareable short links for your configs
- A React single-page app (Vite, Tailwind CSS) with an API on [Hono](https://hono.dev), deployable
  to Cloudflare Workers, Vercel and Netlify from the same build

## Structure

- `src/`: the SPA (React, react-router, use-intl). `vite build` emits it as static files into `dist/`,
  which every platform serves from its CDN. Ordinary page views do not invoke a function;
  Workers explicitly handles `/404` and `/404.html` to enforce the error status.
- `server/`: the API (`/api/*`), one Hono app on the web standard `Request`/`Response`
  (`server/app.ts`, handlers in `server/routes/`), which runs the subconverter WASM package.
- Platform entries use the same parallel layout as `jat001.com`: `worker/index.ts` (Cloudflare
  Workers), `vercel/index.ts` (Vercel Node.js Routing Middleware) and `netlify/functions/index.mts`
  (Netlify Node.js Function). `server/` contains only the shared API and handlers.
- `page-routes.ts` lists the supported page paths. The client router and the build share this list;
  `build/static-pages.ts` emits an `index.html` for each page directory and a bilingual `404.html`.
  Known pages can be opened or refreshed directly from the CDN. Unknown paths return HTTP 404,
  display the localized error page, and bypass the initialization redirect. Client-side navigation
  also displays the error page, but does not make a new document request or change its HTTP status.
  Workers uses `assets.not_found_handling: "404-page"`; Vercel and Netlify use their built-in
  `404.html` handling. Do not add a catch-all rewrite to `/index.html`: it would turn errors into 200s.
  Direct requests for `/404` and `/404.html` need additional handling because `404.html` is also a
  physical file, normally served with status 200. This follows the routing fixes in `jat001.com`:
  Workers routes these paths through `worker/index.ts`, fetches the clean `/404` asset via `ASSETS`
  (avoiding an HTML-normalization redirect), and overrides the status to 404; HEAD has no body.
  Vercel uses `cleanUrls: true`, `trailingSlash: false`, and a GET/HEAD status route for `/404`, with
  an explicit `proxy.entrypoint` matching only `/api/*`. `/404.html` and `/404/` canonicalize to `/404` first.
  Netlify uses forced 404 rewrites for both paths: without `force = true`, the existing file would
  shadow the rule. Unknown paths still use the hosts' native static 404 handling.
  Workers only intercepts `/404`, `/404.html`, and `/404/` in addition to `/api/*`;
  `/404.html/` is left to the static host's native 404 handling.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 24.x or later
- [pnpm](https://pnpm.io/) 12.x
- [Rust](https://www.rust-lang.org/) (for building the WebAssembly component)

### Setup

1. Clone the repository:

```bash
git clone https://github.com/jat001/subconverter-rs.git
cd subconverter-rs
```

2. Build the WebAssembly component:

```bash
scripts/build-wasm.sh
```

3. Install dependencies:

```bash
cd www
pnpm install
```

4. Run the development server, which serves the SPA and runs the API in Node through
   `@hono/vite-dev-server`:

```bash
pnpm dev
```

5. Open [http://localhost:5173](http://localhost:5173) in your browser.

### Platform development servers

Use the globally installed CLIs from `www/`:

```bash
netlify dev                                # http://localhost:8888
vercel dev                                 # http://localhost:3000
wrangler dev                               # built dist/ plus the Worker in workerd
```

Netlify's `[dev]` starts `pnpm run dev` and connects to Vite's default port 5173. Its outer proxy uses
the default port 8888, and serves the Netlify Function, redirect rules and local Blobs. Netlify Dev
loads `www/.env.local`; `netlify dev --offline` also works for local testing without cloud settings.

For Vercel, first use `vercel link` to select the existing project, then `vercel pull` to download its
Development settings and variables. The explicit `devCommand` runs Vite on the port allocated by
Vercel; the CLI substitutes `$PORT` on both Windows and Linux. The outer server keeps its default
port 3000. Set `ADMIN_TOKEN` and optionally `GITHUB_TOKEN` in the Vercel Development context if you
need its local middleware to use them, then pull again. Variables loaded inside Vite are not
automatically shared with the separate middleware process; an unset admin token returns 503.

In Vercel CLI 63.1.0 on Windows, local Node Routing Middleware receives an empty POST body in this
project, with both the Vite and Other presets. GET works. Use `pnpm dev` or `netlify dev` for complete
local API development, and verify the Vercel middleware on a preview deployment. Do not add
`skipMiddlewareRequestBody: false`: false is already the documented default.

### Build for Production

```bash
pnpm build
pnpm test:routing                            # dev/preview HTTP routing regression tests
```

## Deployment

### Admin token

The admin API (`/api/admin/*`, used by the admin, settings and rules pages) and short URL management
(`/api/s`: creating, listing, editing and deleting short URLs; the `/api/s/<id>` redirect stays public)
require the `ADMIN_TOKEN` environment variable on every platform. Without it they answer `503`. The
browser asks for the token the first time a page needs it and keeps it in localStorage.

For local development put it in `www/.env.local`, which `vite dev` and wrangler both read:

```bash
ADMIN_TOKEN=<a long random string>
```

Optionally set `GITHUB_TOKEN` too: missing config and rule files are loaded through the GitHub API, whose
anonymous rate limit is easily exhausted from shared egress IPs such as Cloudflare's.

Each platform below lists the settings that only exist in its dashboard; everything not listed is left at
the platform's default.

### Netlify

`netlify.toml` sets the build command, the publish directory (`www/dist`), the functions directory and
the static 404 handling. The build command runs `scripts/netlify-build.sh` from the repository root, which builds
the WASM package from source (Rust, release profile, Node target only), installs www and runs
`vite build`; Netlify then bundles `netlify/functions/index.mts`, copying the WASM package in as is
(`external_node_modules`). The root has no lockfile, so Netlify does not attempt its own `pnpm install`
of www before the package exists, and it has a `Cargo.lock`, so Netlify caches the Rust toolchain,
`~/.cargo/registry` and `target/` itself.

Dashboard settings (Project configuration):

| Setting | Value |
| --- | --- |
| Base directory | empty (the repository root) |
| Package directory | `www`, where Netlify reads `netlify.toml` |
| Build command, publish and functions directories | empty, `netlify.toml` provides them |
| Runtime | not set. The menu installs one of Netlify's own framework adapters as a build plugin (`@netlify/plugin-nextjs`, `@netlify/angular-runtime`, `@netlify/plugin-gatsby`); these are the only frameworks for which Netlify's framework detection adds a plugin, while other frameworks write Netlify's Frameworks API output (`.netlify/v1/`) themselves. A Vite SPA needs none, and with Next.js selected every build fails because `www/dist` has no Next.js build output |
| Production branch | `null`, a branch that does not exist, so no build deploys to production by itself |
| Branch deploys | all branches |
| Deploy Previews | pull requests against the production branch or a branch deploy branch |
| Build image | Ubuntu Noble 24.04, whose rustup and Corepack the build script relies on |
| Node.js | 24.x (www requires 24 or later) |
| Visitor access | Netlify Team Login for non-production deploys (also the team's default): unpublished deploys and their URLs need a Netlify login, the published deploy is public |
| Environment variables | `ADMIN_TOKEN`, optionally `GITHUB_TOKEN`, with the Functions scope (the API runs as a function) and values for the Branch deploys and Production contexts; the Deploy Previews value is left empty, which turns the admin API off there. Netlify Blobs needs no configuration |

Production deploys consume credits while branch deploys and Deploy Previews are free, so nothing deploys
to production automatically: every push builds a branch deploy, and a finished deploy of `main` goes live
through Publish deploy on its deploy page. The published deploy is still a branch deploy, so it uses the
Branch deploys values of environment variables. Changed variables only apply to deploys built afterwards.

### Vercel

The framework preset is `null` (Other). Vite remains the frontend build tool; the explicit install,
build, output and proxy entry settings provide what this project needs without a framework preset.
The Git integration builds every push from source on Vercel's Linux build machines: `vercel.json` runs
`scripts/vercel-install.sh` as the install command, which builds the WASM package (Rust, release
profile, Node target only) before installing www, then `vite build`. `proxy.entrypoint` selects
`vercel/index.ts` as Node.js Routing Middleware, with `/api/:path*` as the matcher. It returns the
Hono API response directly; pages and assets do not run it, and no `api/` forwarding file or API
rewrite is needed. Prefer that over `vercel build` /
`vercel deploy --prebuilt` from Windows, where the current Vercel CLI stores symlink targets verbatim
(absolute junction paths, backslashes) and misses build traces
([vercel/vercel#17631](https://github.com/vercel/vercel/pull/17631),
[vercel/vercel#17632](https://github.com/vercel/vercel/pull/17632)). The static build caches
`node_modules`, so the script keeps the cargo registry, build
artifacts and WASM tools in `www/node_modules/.cache` and installs the Rust toolchain on every build.
Other was verified with a cold Linux preview and a second preview restoring its build cache;
the Rust step took 2m46s and 54s respectively.

The explicit proxy entry is Routing Middleware on Node.js, so its documented request limits apply
(including a 4 MB request body). See [Routing Middleware](https://vercel.com/docs/routing-middleware).

Dashboard settings (project Settings). The framework preset, install and build commands show up there
too; `vercel.json` overrides them, so keep the two the same:

| Setting | Value |
| --- | --- |
| Root Directory | `www` |
| Include files outside the root directory in the Build Step | enabled, the install script builds from the repository root |
| Node.js Version | 24.x; `engines.node` in `package.json` takes precedence anyway |
| Production branch | `main`; other branches and pull requests get preview deployments |
| Deployment Protection | Vercel Authentication, Standard Protection: previews need a Vercel login, the production domain is public |
| Environment variables | `ADMIN_TOKEN`, optionally `GITHUB_TOKEN`; an Upstash Redis store connected from the Marketplace provides `KV_REST_API_URL` and `KV_REST_API_TOKEN` (without one, files are only kept in memory) |

### Cloudflare Workers

`wrangler.jsonc` deploys `dist/` as static assets and `worker/index.ts` as the Worker, which only receives
`/api/*` and explicit 404 URLs (`run_worker_first`). Known pages are served as static files; unknown
paths use the static `404.html` response. Ordinary page views use no Worker CPU time. wrangler bundles
the Worker with the Workers build of the WASM package. Deploy a
release-profile WASM build: a development build uses about 2 s of CPU per conversion and runs into the
Workers CPU time limit. `--optimize` builds one without changing versions, and runs wasm-opt on the
Workers package (a quarter smaller, slightly faster startup):

```bash
# from the repository root
./scripts/build-wasm.sh --optimize
```

Then, in `www/`:

```bash
pnpm build
wrangler dev                            # try the Worker locally in workerd
wrangler deploy
wrangler secret put ADMIN_TOKEN
```

Local commands use the globally installed Wrangler on PATH. Wrangler is not a www dependency;
Vercel and Netlify do not use it. CI and Workers Builds provision the CLI through `pnpx wrangler`
(`pnpm dlx wrangler`). The pnpx install is separate from the app and reuses pnpm's cache.

A conversion with the default rule sets takes roughly 150–900 ms of CPU time on Workers (measured with
`wrangler tail`). The Workers Free plan allows 10 ms per request and only tolerates occasional overruns,
so some conversions fail with `exceededCpu` there; Workers Paid (30 s by default) runs them reliably.

Every Worker setting a deploy writes (compatibility date, assets, cache, observability, the `KV`
binding, the workers.dev and preview URLs) lives in `wrangler.jsonc`, and the next deploy applies the
file's values over any dashboard change. Only the secrets `ADMIN_TOKEN` and optionally `GITHUB_TOKEN`
(Settings > Variables and Secrets, or `wrangler secret put`), the build settings below and the account's
Cloudflare Access protection of preview URLs (a login with the Cloudflare account) exist in the
dashboard alone.

#### Workers Builds

With the repository connected in the Worker's Git integration, every push builds everything from source
(Rust, the WASM package, the SPA) through `scripts/workers-build.sh`, and the deploy command bundles
and deploys the Worker. Settings > Build:

| Setting | Value |
| --- | --- |
| Git repository | `jat001/subconverter-rs` |
| Branch control | production branch `main` |
| Root directory | `www` |
| Build command | `bash ../scripts/workers-build.sh` |
| Deploy command | `pnpx wrangler deploy` |
| Preview branch builds (the Preview tab of Build) | enabled, so other branches and pull requests get preview builds; their own settings repeat the build command, root directory, watch paths and variables, with `pnpx wrangler preview` as the preview command (Workers Previews, `previews` in `wrangler.jsonc`) |
| Build watch paths | include `*` (the default), so changes anywhere in the repository rebuild |
| Build variables | `SKIP_DEPENDENCY_INSTALL=1` (www installs only after `../pkg` is built), `PNPM_VERSION=12` |
| Build cache | enabled |

Workers Builds caches the pnpm store plus the output directories of frameworks it detects, none of
which applies to a Vite SPA, so the script keeps the Rust toolchain, cargo registry, build artifacts and
wasm-pack's tools inside the cached pnpm store directory to reuse them between builds. wasm-opt runs
through `scripts/wasm-opt-cache.sh`, which reuses the previous output when the Rust code did not change.

## License

MIT
