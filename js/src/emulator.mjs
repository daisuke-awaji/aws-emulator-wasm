// Loads the emulator wasm in Node (node:wasi) and serves requests through its C ABI.
import { readFile } from 'node:fs/promises';
import { WASI } from 'node:wasi';
import { decodeResponse, encodeRequest } from './codec.mjs';

/**
 * @param {string} wasmPath
 * @returns {Promise<{ fetch: (req: {method: string, url: string, headers: [string, string][], body: Uint8Array}) => {status: number, headers: [string, string][], body: Uint8Array}, tick: () => void }>}
 */
export async function loadEmulator(wasmPath) {
  const wasi = new WASI({ version: 'preview1', args: ['aws-emulator'], env: {}, returnOnExit: true });
  const module = await WebAssembly.compile(await readFile(wasmPath));
  const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
  wasi.initialize(instance);
  const e = instance.exports;

  return {
    fetch(req) {
      const frame = encodeRequest(req);
      const ptr = e.emu_alloc(frame.length);
      // Views are taken after every call into wasm: memory.grow detaches the old buffer.
      new Uint8Array(e.memory.buffer, ptr, frame.length).set(frame);
      const len = e.emu_handle(ptr, frame.length);
      const out = new Uint8Array(e.memory.buffer, e.emu_response_ptr(), len).slice();
      return decodeResponse(out);
    },
    tick() {
      e.emu_tick();
    },
  };
}
