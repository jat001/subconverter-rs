#!/bin/bash
# Build command of the Netlify site (www/netlify.toml): builds the WASM package from source on Netlify's
# Linux build machine, installs www and runs `next build` for Netlify's Next.js runtime to deploy.
#
# Site settings: base directory unset (repository root), package directory `www`. The build runs from the
# base directory, which has no lockfile, so Netlify does not run its own `pnpm install` of www before the
# WASM package it depends on (file:../pkg) exists. The base directory does have a Cargo.lock, so Netlify
# caches the preinstalled rustup toolchain, ~/.cargo/registry and target/ itself; only the small WASM
# tools are fetched on every build. www/README.md lists the site's other dashboard settings.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cache="$HOME/.cache/subconverter-netlify"
CI_RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
CI_CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
CI_TARGET_DIR="$repo_root/target"
# shellcheck source=ci-toolchain.sh
source "$repo_root/scripts/ci-toolchain.sh"

# www and wasm-host require pnpm 12 (devEngines). The image's pnpm is a Corepack shim with an older default
# (npm cannot install over it), so make pnpm 12 Corepack's global default instead
PNPM_VERSION="${PNPM_VERSION:-12}"
if [ "$(pnpm --version 2>/dev/null | cut -d. -f1)" != "${PNPM_VERSION%%.*}" ]; then
  echo "Activating pnpm $PNPM_VERSION through Corepack..."
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack install --global "pnpm@$PNPM_VERSION"
fi

cd "$repo_root"
# Builds wasm-host and the nodejs package in release mode (the functions run on Node), then installs www
./scripts/build-wasm.sh --optimize --no-workers
ci_toolchain_cleanup

cd www
pnpm run build
