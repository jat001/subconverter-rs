#!/bin/bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

# Start stopwatch
BUILD_START_TIME=$SECONDS

# Script description
cat <<"EOF"
Subconverter local WASM build
  --release / --optimize  Build both packages with the release profile
  --no-workers           Build only the Node.js package
  --version X.Y.Z        Verify the source version before building
  --help                 Show this help
The source version comes from Cargo.toml. Publication is performed by version-tag CI.
EOF

# Check if wasm-pack is installed
if ! command -v wasm-pack &>/dev/null; then
  echo "wasm-pack is required. Install it with 'cargo install wasm-pack' (see https://github.com/wasm-bindgen/wasm-pack)."
  exit 1
fi

# Check if jq is installed
if ! command -v jq &>/dev/null; then
  echo "jq is required. Please install it using your package manager."
  exit 1
fi

# Check if pnpm is installed
if ! command -v pnpm &>/dev/null; then
  echo "pnpm is required to build the host bindings and install the packages. Please install it (e.g., 'npm install -g pnpm')."
  exit 1
fi

# wasm-pack regenerates pkg/package.json on every build. Stash the current one first so it can be kept
# as-is (content and mtime) when the patched result is identical, avoiding needless reinstalls in www.
PKG_JSON_BACKUP=target/pkg-package.json.bak
# Runtime dependencies of the wasm-host bindings (shipped in pkg/snippets/) are declared in wasm-host/package.json
HOST_PKG_JSON=wasm-host/package.json

# Compile the TypeScript bindings (wasm-host/src -> wasm-host/dist) that wasm-bindgen embeds
build_wasm_host() {
  echo "Building wasm-host bindings..."
  pnpm --dir wasm-host install --frozen-lockfile
  pnpm --dir wasm-host run build
}

backup_pkg_json() {
  rm -f "$PKG_JSON_BACKUP"
  if [ -f pkg/package.json ]; then
    mkdir -p target
    cp -p pkg/package.json "$PKG_JSON_BACKUP"
  fi
}

# Apply our changes on top of the wasm-pack output, only replacing the previous file when something differs
update_pkg_json() {
  local pkg_version="$1"
  local tmp=pkg/package.json.tmp
  jq --arg ver "$pkg_version" --slurpfile host "$HOST_PKG_JSON" -f scripts/pkg-package.jq pkg/package.json >"$tmp"

  if [ -f "$PKG_JSON_BACKUP" ] && [ "$(jq -S . "$PKG_JSON_BACKUP")" = "$(jq -S . "$tmp")" ]; then
    mv "$PKG_JSON_BACKUP" pkg/package.json
    rm -f "$tmp"
    echo "pkg/package.json unchanged, kept existing file"
  else
    mv "$tmp" pkg/package.json
    rm -f "$PKG_JSON_BACKUP"
    echo "pkg/package.json updated"
  fi
  cp wasm-host/package-readme.md pkg/README.md
}

# Cloudflare Workers build, published as `@jat/subconverter-wasm/workers`: the same crate through
# `--target web`, plus the entry in wasm-host/workers/ that instantiates the precompiled module
# (Workers cannot compile WebAssembly from bytes at runtime).
build_workers_pkg() {
  local mode="$1" # --release or --dev
  echo "Building Cloudflare Workers wasm package ($mode)..."
  rm -rf pkg/workers
  wasm-pack build "$mode" --target web --out-dir pkg/workers --no-pack
  # wasm-pack writes a `*` .gitignore, which would make npm drop the whole directory when publishing
  rm -f pkg/workers/.gitignore
  # Merged into pkg/workers/: the entry files, plus snippets/package.json, which marks the copied host
  # bindings (compiled as CommonJS for the nodejs build) as CommonJS inside this "type": "module" package;
  # spec-following bundlers such as esbuild (wrangler) otherwise treat them as ESM and `exports` is undefined
  cp -r wasm-host/workers/. pkg/workers/
}

profile=--dev
skip_workers=false
requested_version=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --release|--optimize|-r) profile=--release; shift ;;
    --no-workers) skip_workers=true; shift ;;
    --version|-v) requested_version="$2"; shift 2 ;;
    --help|-h) exit 0 ;;
    *) echo "Unknown build option: $1" >&2; exit 1 ;;
  esac
done
version=$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -n 1)
if [ -n "$requested_version" ] && [ "$requested_version" != "$version" ]; then
  echo "Update and commit the source/documentation version before building $requested_version (source is $version)" >&2
  exit 1
fi
build_wasm_host
backup_pkg_json
rm -rf pkg/snippets
wasm-pack build "$profile" --target nodejs --no-opt
if [ "$skip_workers" = false ]; then
  build_workers_pkg "$profile"
else
  rm -rf pkg/workers
fi
update_pkg_json "$version"
pnpm --dir pkg install
pnpm --dir www install
echo "Local WASM packages built for $version in $((SECONDS - BUILD_START_TIME)) seconds"
