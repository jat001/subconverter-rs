// Cloudflare Workers entry for subconverter-wasm, published as `subconverter-wasm/workers`.
// The build scripts copy this directory next to the `wasm-pack --target web` output in pkg/workers/.
//
// Workers cannot compile WebAssembly from bytes at runtime, so the .wasm file is imported as a
// precompiled WebAssembly.Module (wrangler's default CompiledWasm rule for *.wasm) and instantiated
// synchronously when this module is first imported.
import wasmModule from './libsubconverter_bg.wasm'
import { initSync } from './libsubconverter.js'

initSync({ module: wasmModule })

export * from './libsubconverter.js'
