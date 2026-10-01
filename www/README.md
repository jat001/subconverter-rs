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

### Cloudflare Workers

Workers run the app through [vinext](https://github.com/cloudflare/vinext) instead of `next build`; the
Worker and its `KV` binding are configured in `wrangler.jsonc`. The development WASM build is too large
for the Workers size limit, so build an optimized one first (versions are left untouched):

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

## License

MIT
