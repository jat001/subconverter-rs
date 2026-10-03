#!/bin/bash
# Full from-source build of www for Cloudflare Workers Builds: Rust -> WASM package -> SPA; the deploy
# command (`wrangler deploy`) then bundles the API Worker. Every push builds everything (build watch
# paths include everything), nothing comes from a release.
#
# The Worker's build settings (root directory www, this script as the build command, the deploy command,
# SKIP_DEPENDENCY_INSTALL and PNPM_VERSION) only exist in the dashboard; www/README.md lists them under
# Workers Builds.
#
# Workers Builds caches the package manager store, plus output directories of the frameworks it detects,
# none of which applies to a Vite SPA. The Rust toolchain, the cargo registry, the build artifacts and
# wasm-pack's tools are therefore kept inside the cached pnpm store directory. Without that cache the
# build still works, it just starts from scratch.
set -euo pipefail

# The wasm-opt release wasm-pack 0.15 downloads by default, so the output matches local builds
BINARYEN_VERSION=version_117

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cache="$HOME/.local/share/pnpm/store/subconverter-workers-build"
# shellcheck source=ci-toolchain.sh
source "$repo_root/scripts/ci-toolchain.sh"

# wasm-pack also takes wasm-opt from PATH: a wrapper that reuses the previous output when the Rust code
# did not change (see wasm-opt-cache.sh), around the pinned binaryen release
if [ "$(cat "$cache/binaryen/VERSION" 2>/dev/null)" != "$BINARYEN_VERSION" ]; then
  echo "Installing binaryen $BINARYEN_VERSION..."
  rm -rf "$cache/binaryen"
  mkdir -p "$cache/binaryen/bin"
  archive="binaryen-$BINARYEN_VERSION"
  curl -sSfL "https://github.com/WebAssembly/binaryen/releases/download/$BINARYEN_VERSION/$archive-x86_64-linux.tar.gz" |
    tar -xz --strip-components=2 -C "$cache/binaryen/bin" "$archive/bin/wasm-opt"
  echo "$BINARYEN_VERSION" >"$cache/binaryen/VERSION"
fi
install -m 755 "$repo_root/scripts/wasm-opt-cache.sh" "$bin/wasm-opt"

cd "$repo_root"
# Builds wasm-host, both WASM targets in release mode and installs www
./scripts/build-wasm.sh --optimize
ci_toolchain_cleanup

cd www
pnpm run build
