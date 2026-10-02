#!/bin/bash
# Full from-source build of www for Cloudflare Workers Builds: Rust -> WASM package -> vinext Worker.
# Every push builds everything (build watch paths include everything), nothing comes from a release.
#
# Worker settings (Settings > Build):
#   Root directory:   www
#   Build command:    bash ../scripts/workers-build.sh
#   Deploy command:   pnpm exec wrangler deploy --config dist/server/wrangler.json
#   Non-production branch deploy command:
#                     pnpm exec wrangler versions upload --config dist/server/wrangler.json
#   Build variables:  SKIP_DEPENDENCY_INSTALL=1 (www can only be installed once ../pkg is built)
#                     PNPM_VERSION=12.8.2
#
# Workers Builds caches only package manager stores and the output directories of frameworks it
# detects, so the Rust toolchain, the cargo registry, the build artifacts and wasm-pack's tools are
# kept in www/.next/cache, the directory it saves for Next.js projects. Without that cache the
# build still works, it just starts from scratch.
set -euo pipefail

WASM_PACK_VERSION=0.15.0
JQ_VERSION=1.8.2

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cache="$repo_root/www/.next/cache/workers-build"
bin="$cache/bin"
export RUSTUP_HOME="$cache/rustup"
export CARGO_HOME="$cache/cargo"
export CARGO_TARGET_DIR="$cache/target"
export WASM_PACK_CACHE="$cache/wasm-pack"
export PATH="$bin:$CARGO_HOME/bin:$PATH"
mkdir -p "$bin"

if [ ! -x "$CARGO_HOME/bin/rustup" ]; then
  echo "Installing rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs |
    sh -s -- -y --no-modify-path --profile minimal --default-toolchain none
fi
rustup toolchain install stable --profile minimal --target wasm32-unknown-unknown
rustup default stable

if [ "$(wasm-pack --version 2>/dev/null)" != "wasm-pack $WASM_PACK_VERSION" ]; then
  echo "Installing wasm-pack $WASM_PACK_VERSION..."
  archive="wasm-pack-v$WASM_PACK_VERSION-x86_64-unknown-linux-musl"
  curl -sSfL "https://github.com/wasm-bindgen/wasm-pack/releases/download/v$WASM_PACK_VERSION/$archive.tar.gz" |
    tar -xz --strip-components=1 -C "$bin" "$archive/wasm-pack"
fi

if ! command -v jq >/dev/null; then
  echo "Installing jq $JQ_VERSION..."
  curl -sSfL -o "$bin/jq" "https://github.com/jqlang/jq/releases/download/jq-$JQ_VERSION/jq-linux-amd64"
  chmod +x "$bin/jq"
fi

cd "$repo_root"
# Builds wasm-host, both WASM targets in release mode and installs www
./scripts/build-wasm.sh --optimize

cd www
pnpm run build:vinext
