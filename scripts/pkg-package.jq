# Applied to the package.json that wasm-pack generates in pkg/, shared by build-wasm.sh, build-wasm.ps1
# and .github/workflows/wasm-release.yml.
#
#   jq --arg ver X.Y.Z --slurpfile host wasm-host/package.json -f scripts/pkg-package.jq pkg/package.json
#
# Runtime dependencies of the wasm-host bindings (shipped in pkg/snippets/) are declared in
# wasm-host/package.json and merged in here.
#
# The root export resolves to the Cloudflare Workers build under the `workerd` condition (used by
# wrangler and @cloudflare/vite-plugin), so the same `import '@jat/subconverter-wasm'` works on Node
# and on Workers.
.name = "@jat/subconverter-wasm"
| .publishConfig = {"access": "public"}
| .version = $ver
| .repository = {"type": "git", "url": "git+https://github.com/jat001/subconverter-rs.git"}
| .files = ((.files // []) as $f | $f + (["snippets/", "workers/"] - $f))
| .exports = {
    ".": {
      "types": "./libsubconverter.d.ts",
      "workerd": "./workers/index.js",
      "default": "./libsubconverter.js"
    },
    "./workers": {
      "types": "./workers/index.d.ts",
      "default": "./workers/index.js"
    },
    "./package.json": "./package.json"
  }
| .dependencies = ((.dependencies // {}) + ($host[0].dependencies // {}))
