# Subconverter Web UI

A modern web UI for the subconverter-rs project, deployable to Vercel with a single click. This project allows you to convert proxy subscriptions to various formats and create shareable links with custom configurations.

## Features

- Convert proxy subscriptions to different formats (Clash, Surge, Quantumult X, etc.)
- Create and save custom configurations
- Generate shareable short links for your configs
- Modern, responsive UI built with Next.js and Tailwind CSS

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

4. Run the development server:

```bash
pnpm dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

### Build for Production

```bash
pnpm build
```

## Deployment

### Admin token

The admin API (`/api/admin/*`, used by the admin, settings and rules pages) and short URL management
(`/api/s`: creating, listing, editing and deleting short URLs; the `/api/s/<id>` redirect stays public)
require the `ADMIN_TOKEN` environment variable on every platform. Without it they answer `503`. The
browser asks for the token the first time a page needs it and keeps it in localStorage.

For local development put it in `www/.env.local`, which `next dev`, vinext and wrangler all read:

```bash
ADMIN_TOKEN=<a long random string>
```

Optionally set `GITHUB_TOKEN` too: missing config and rule files are loaded through the GitHub API, whose
anonymous rate limit is easily exhausted from shared egress IPs such as Cloudflare's.

### Netlify / Vercel

Both build with `next build` (`netlify.toml`, `vercel.json`). Set `ADMIN_TOKEN` in the site's environment
variables.

```bash
pnpm deploy:netlify
```

On Vercel the Git integration builds every push from source on its Linux build machines (Root
Directory `www`): `vercel.json` runs `scripts/vercel-install.sh` as the install command, which builds
the WASM package (Rust, release profile, Node target only) before installing www, and `next build` runs
as usual. Prefer that over `vercel build` / `vercel deploy --prebuilt` from Windows, where the current
Vercel CLI stores symlink targets verbatim (absolute junction paths, backslashes) and misses build traces
([vercel/vercel#17631](https://github.com/vercel/vercel/pull/17631),
[vercel/vercel#17632](https://github.com/vercel/vercel/pull/17632)). Vercel's build cache only covers
`node_modules` and `.next/cache` (1 GB in all), so the script keeps the cargo registry, build artifacts and
WASM tools in `www/.next/cache` and installs the Rust toolchain on every build.

### Cloudflare Workers

Workers run the app through [vinext](https://github.com/cloudflare/vinext) instead of `next build`; the
Worker and its `KV` binding are configured in `wrangler.jsonc`. Deploy a release-profile WASM build: a
development build uses about 2 s of CPU per conversion and runs into the Workers CPU time limit.
`--optimize` builds one without changing versions, and runs wasm-opt on the Workers package (a quarter
smaller, slightly faster startup):

```bash
# from the repository root
./scripts/build-wasm.sh --optimize
```

Then, in `www/`:

```bash
pnpm run build:vinext
pnpm run start:vinext                    # try the built Worker locally in workerd
pnpm run deploy:vinext
pnpm exec wrangler secret put ADMIN_TOKEN
```

A conversion with the default rule sets takes roughly 150–900 ms of CPU time on Workers (measured with
`wrangler tail`). The Workers Free plan allows 10 ms per request and only tolerates occasional overruns,
so some conversions fail with `exceededCpu` there; Workers Paid (30 s by default) runs them reliably.

#### Workers Builds

With the repository connected in the Worker's Git integration, every push builds everything from source
(Rust, the WASM package, the Worker) through `scripts/workers-build.sh`. Configure Settings > Build as:

| Setting | Value |
| --- | --- |
| Root directory | `www` |
| Build command | `bash ../scripts/workers-build.sh` |
| Deploy command | `pnpm exec wrangler deploy --config dist/server/wrangler.json` |
| Non-production branch deploy command | `pnpm exec wrangler versions upload --config dist/server/wrangler.json` (only if branch builds are enabled) |
| Build watch paths | include `*` (the default), so changes anywhere in the repository rebuild |
| Build variables | `SKIP_DEPENDENCY_INSTALL=1` (www installs only after `../pkg` is built), `PNPM_VERSION=12.8.2` |
| Build cache | enabled |

Workers Builds caches the pnpm store and the `.next/cache` directory of Next.js projects only, so the
script keeps the Rust toolchain, cargo registry, build artifacts and wasm-pack's tools in
`www/.next/cache` to reuse them between builds. wasm-opt runs through `scripts/wasm-opt-cache.sh`,
which reuses the previous output when the Rust code did not change.

## License

MIT
