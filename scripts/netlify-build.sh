#!/bin/bash
# Build command of the Netlify site (www/netlify.toml): builds the WASM package from source on Netlify's
# Linux build machine, installs www and runs `next build` for Netlify's Next.js runtime to deploy.
#
# Site settings: base directory unset (repository root), package directory `www`. The build runs from the
# base directory, which has no lockfile, so Netlify does not run its own `pnpm install` of www before the
# WASM package it depends on (file:../pkg) exists. The base directory does have a Cargo.lock, so Netlify
# caches the preinstalled rustup toolchain, ~/.cargo/registry and target/ itself; only the small WASM
# tools are fetched on every build.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cache="$HOME/.cache/subconverter-netlify"
CI_RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
CI_CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
CI_TARGET_DIR="$repo_root/target"
# shellcheck source=ci-toolchain.sh
source "$repo_root/scripts/ci-toolchain.sh"

# www and wasm-host require pnpm 12 (devEngines), while the build image provides an older default
if [ "$(pnpm --version 2>/dev/null | cut -d. -f1)" != 12 ]; then
  echo "Installing pnpm 12..."
  npm install -g pnpm@12
fi

cd "$repo_root"
# Builds wasm-host and the nodejs package in release mode (the functions run on Node), then installs www
./scripts/build-wasm.sh --optimize --no-workers
ci_toolchain_cleanup

cd www
pnpm run build
