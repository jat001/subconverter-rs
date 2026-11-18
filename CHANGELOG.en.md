# Changelog

[简体中文](CHANGELOG.md)

## 0.3.2

This release updates the conversion engine, web app, and WASM dependencies. Existing subscription URLs, configurations, and short URLs require no migration.

- Updated the native HTTP, TLS, and template engine dependencies, along with React, Vite, Hono, and the WASM storage libraries.
- Building the web app from source now uses Node.js 26 LTS and pnpm 12. The Vercel and Netlify build scripts install pnpm 12 when needed.
- Updated the Cloudflare Workers compatibility date to `2026-11-18`, which enables the new module registry.
- Platform builds reinstall Rust when the cached compiler cannot run.

## 0.3.1

This release improves installation and distribution for the 0.3 series. Subscription conversion, interfaces, and storage formats carry over from 0.3.0. Existing configurations and short URLs require no migration.

- Corrected outdated Next.js deployment instructions and clarified how to use the web app and the WASM package.
- Expanded build checks for native Linux, macOS, and Windows archives and amd64/arm64 container images. Fixed architecture detection for macOS and 32-bit Linux in the installer.
- npm and crates.io now authenticate through GitHub Trusted Publishing. The release workflow uses short-lived credentials issued for each publish.

## 0.3.0

This release updates `jat001/subconverter-rs` from the upstream 0.2 series. It unifies web deployment, adds full Cloudflare Workers support, and improves subscription error messages and admin access controls.

### Web app and deployment

- The web app is a React single-page application. Cloudflare Workers, Vercel, and Netlify serve the same pages and API. Static hosting serves the pages, and the backend handles conversion, file management, and short URLs.
- Added a WASM build for Cloudflare Workers. Use the `KV` binding in `wrangler.jsonc` to store configurations and short URLs.
- All three platforms build the conversion engine from source. Their build caches can reuse the Rust toolchain, dependencies, and compiled artifacts.
- Known pages support direct navigation and refresh. Unknown paths return HTTP 404 with an error page available in Chinese and English.

### Conversion and storage

- Subscription download errors show the HTTP status and the failing source. Messages also distinguish empty subscriptions, login or other HTML pages, unrecognized nodes, and cases where filters remove all nodes.
- Fixed binary and JSON-text reads and writes in Upstash Redis. Values written in the previous format remain readable.
- Fixed data corruption when WASM memory grows during asynchronous storage calls. Directory deletion now clears both file contents and directory records.
- Shortened configuration cache lifetimes so backend instances pick up updates sooner.

### Admin access

- File management, rule updates, and creating, editing, or deleting short URLs require an admin token. These endpoints are disabled when `ADMIN_TOKEN` is unset.
- The browser prompts for the admin token when needed. Subscription conversion and redirects for existing public short URLs remain available without it.

### Upgrading an existing deployment

- The web app now uses Vite. Select the Other framework preset on Vercel and leave the framework runtime unset on Netlify. See the [web deployment guide](www/README.md) for all three platforms.
- Web builds and the Node backend use Node.js 24 LTS. The web app package is now named `subconverter-web`.
- Set `ADMIN_TOKEN` in each deployment environment where you need to manage files or short URLs. Existing configurations and storage namespaces can be reused.
- Custom Jinja templates use an updated engine. Rendering a boolean directly still produces lowercase `true` or `false`. Check templates that use arithmetic, `round`, or `tojson` before upgrading.
