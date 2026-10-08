#!/bin/bash
# Install step of the Vercel build (installCommand in www/vercel.json, run in www): builds the WASM package
# from source on Vercel's Linux build machine, then installs www, which depends on it (file:../pkg).
# The build command runs `vite build`; Vercel deploys vercel/index.ts as Node.js Routing Middleware.
# Building on Linux also keeps the Windows-only Vercel CLI problems (symlink targets, build trace
# lookups) out of the way, as no Windows-built artifacts are uploaded.
#
# With the Vite framework preset Vercel restores only node_modules between builds (at most 1 GB, most of
# it www's node_modules), so the cargo registry, the build artifacts and the WASM tools are kept in
# www/node_modules/.cache; the Rust toolchain (~700 MB) is installed on every build.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cache="$repo_root/www/node_modules/.cache/vercel-build"
CI_RUSTUP_HOME="$HOME/.rustup"

# Build scripts and proc macros of Rust dependencies are linked with the system C compiler
if ! command -v cc >/dev/null; then
  echo "Installing gcc..."
  dnf install -y gcc
fi

# shellcheck source=ci-toolchain.sh
source "$repo_root/scripts/ci-toolchain.sh"

cd "$repo_root"
# Builds wasm-host and the nodejs package in release mode (Vercel runs it on Node), then installs www
./scripts/build-wasm.sh --optimize --no-workers
ci_toolchain_cleanup
