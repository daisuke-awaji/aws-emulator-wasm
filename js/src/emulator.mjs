// Loads the emulator wasm in Node and serves requests through its C ABI.
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { WASI } from 'node:wasi';
import { instantiateEmulator } from './core.mjs';
import { createWasi } from './wasi.mjs';

/**
 * @param {string} wasmPath
 * @param {{ wasi?: 'node' | 'shim', clock?: 'virtual' | 'real' }} [options]
 *   wasi: 'node' uses node:wasi (real clocks); 'shim' uses the same WASI code as the browser.
 */
export async function loadEmulator(wasmPath, options = {}) {
  const module = await WebAssembly.compile(await readFile(wasmPath));
  if ((options.wasi ?? 'node') === 'shim') {
    return instantiateEmulator(module, createWasi({ clock: options.clock }));
  }
  const wasi = new WASI({ version: 'preview1', args: ['aws-emulator'], env: {}, returnOnExit: true });
  return instantiateEmulator(module, {
    imports: wasi.getImportObject(),
    initialize: (instance) => wasi.initialize(instance),
  });
}

/** Response bodies as the Node SDK expects them for streaming outputs (S3 GetObject). */
export const nodeResponseBody = (bytes) => Readable.from([Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)]);
