// Drives one emulator instance through the C ABI of crates/wasm-host. Platform-neutral:
// the caller supplies the compiled module and the WASI imports.
import { decodeResponse, encodeRequest } from './codec.mjs';

/**
 * @param {WebAssembly.Module} module
 * @param {{ imports: WebAssembly.Imports, initialize: (instance: WebAssembly.Instance) => void }} wasi
 */
export async function instantiateEmulator(module, wasi) {
  const instance = await WebAssembly.instantiate(module, wasi.imports);
  wasi.initialize(instance);
  const e = instance.exports;

  /** Serves one encoded request frame and returns the encoded response frame (a copy). */
  const handleFrame = (frame) => {
    const ptr = e.emu_alloc(frame.length);
    // Views are taken after every call into wasm: memory.grow detaches the old buffer.
    new Uint8Array(e.memory.buffer, ptr, frame.length).set(frame);
    const len = e.emu_handle(ptr, frame.length);
    const out = new Uint8Array(e.memory.buffer, e.emu_response_ptr(), len).slice();
    // Let tasks the handler spawned run a little before the next request.
    e.emu_tick();
    return out;
  };

  return {
    handleFrame,
    /** @param {{method: string, url: string, headers: [string, string][], body: Uint8Array}} req */
    fetch: (req) => decodeResponse(handleFrame(encodeRequest(req))),
    tick: () => e.emu_tick(),
    /** Bytes of wasm memory in use. */
    get memoryBytes() {
      return e.memory.buffer.byteLength;
    },
  };
}
