#!/bin/bash
# wasm-opt with a result cache, installed as `wasm-opt` in PATH by workers-build.sh, where wasm-pack
# picks it up and runs `wasm-opt IN -o OUT ARGS...`. Optimizing takes over a minute, but its input
# only changes with the Rust code, so a build that changes nothing else reuses the previous output.
#
# Expects the real binary at ../binaryen/bin/wasm-opt and keeps results in ../wasm-opt-results.
set -euo pipefail

dir="$(cd "$(dirname "$0")/.." && pwd)"
real="$dir/binaryen/bin/wasm-opt"
store="$dir/wasm-opt-results"

if [ "$#" -lt 3 ] || [ "$2" != "-o" ]; then
  exec "$real" "$@"
fi

key="$({
  sha256sum <"$1"
  printf '%s\n' "${@:4}"
  "$real" --version
} | sha256sum | cut -c1-64)"

if [ -f "$store/$key.wasm" ]; then
  echo "wasm-opt: reusing the cached output for an unchanged input"
  cp "$store/$key.wasm" "$3"
  exit 0
fi

"$real" "$@"
mkdir -p "$store"
cp "$3" "$store/$key.wasm"
# Keep only the newest few results
ls -t "$store"/*.wasm | tail -n +4 | xargs -r rm -f
