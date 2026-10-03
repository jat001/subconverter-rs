# Sourced by the platform builds (workers-build.sh, vercel-install.sh) to set up a from-source WASM build
# on a Linux build machine: rustup with the wasm32 target, wasm-pack, a wasm-bindgen matching Cargo.lock
# and jq. Everything is kept under $cache so the platform's build cache can carry it to the next build.
#
# Expects `repo_root` and `cache`. CI_RUSTUP_HOME, CI_CARGO_HOME and CI_TARGET_DIR may be set beforehand to
# put the toolchain (~700 MB, the largest part), cargo's home or the build artifacts somewhere else than
# $cache, e.g. where the platform caches them itself. Call ci_toolchain_cleanup after building.

WASM_PACK_VERSION=0.15.0
JQ_VERSION=1.8.2

bin="$cache/bin"
export RUSTUP_HOME="${CI_RUSTUP_HOME:-$cache/rustup}"
export CARGO_HOME="${CI_CARGO_HOME:-$cache/cargo}"
export CARGO_TARGET_DIR="${CI_TARGET_DIR:-$cache/target}"
export WASM_PACK_CACHE="$cache/wasm-pack"
export PATH="$bin:$CARGO_HOME/bin:$PATH"
# wasm-pack downloads missing tools into WASM_PACK_CACHE but does not create it
mkdir -p "$bin" "$WASM_PACK_CACHE"

if [ ! -x "$CARGO_HOME/bin/rustup" ]; then
  echo "Installing rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs |
    sh -s -- -y --no-modify-path --profile minimal --default-toolchain none
fi
rustup toolchain install stable --profile minimal --target wasm32-unknown-unknown
rustup default stable

# Artifacts from another compiler version are never reused, so drop them instead of caching them
rustc_version="$(rustc -V)"
if [ "$(cat "$CARGO_TARGET_DIR/.rustc-version" 2>/dev/null)" != "$rustc_version" ]; then
  rm -rf "$CARGO_TARGET_DIR"
  mkdir -p "$CARGO_TARGET_DIR"
  echo "$rustc_version" >"$CARGO_TARGET_DIR/.rustc-version"
fi

if [ "$(wasm-pack --version 2>/dev/null)" != "wasm-pack $WASM_PACK_VERSION" ]; then
  echo "Installing wasm-pack $WASM_PACK_VERSION..."
  archive="wasm-pack-v$WASM_PACK_VERSION-x86_64-unknown-linux-musl"
  curl -sSfL "https://github.com/wasm-bindgen/wasm-pack/releases/download/v$WASM_PACK_VERSION/$archive.tar.gz" |
    tar -xz --strip-components=1 -C "$bin" "$archive/wasm-pack"
fi

# wasm-pack uses a wasm-bindgen from PATH when its version matches Cargo.lock; otherwise it may fall back
# to compiling wasm-bindgen-cli with `cargo install`, which is slow and bloats the cache
wasm_bindgen_version="$(awk '/^name = "wasm-bindgen"$/ { getline; gsub(/version = |"/, ""); print; exit }' "$repo_root/Cargo.lock")"
if [ "$(wasm-bindgen --version 2>/dev/null)" != "wasm-bindgen $wasm_bindgen_version" ]; then
  echo "Installing wasm-bindgen $wasm_bindgen_version..."
  archive="wasm-bindgen-$wasm_bindgen_version-x86_64-unknown-linux-musl"
  curl -sSfL "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/$wasm_bindgen_version/$archive.tar.gz" |
    tar -xz --strip-components=1 -C "$bin" "$archive/wasm-bindgen" "$archive/wasm-bindgen-test-runner"
fi

if ! command -v jq >/dev/null; then
  echo "Installing jq $JQ_VERSION..."
  curl -sSfL -o "$bin/jq" "https://github.com/jqlang/jq/releases/download/jq-$JQ_VERSION/jq-linux-amd64"
  chmod +x "$bin/jq"
fi

# Extracted crate sources are recreated from registry/cache on demand; no need to cache them twice
ci_toolchain_cleanup() {
  rm -rf "$CARGO_HOME/registry/src"
}
