// Loads the emulator wasm in Node and serves requests through its C ABI.
//
//   import { loadEmulator } from 'aws-emulator-wasm/node';
//   const emulator = await loadEmulator();
//   const ddb = new DynamoDBClient(emulator.clientConfig());
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { WASI } from 'node:wasi';
import { instantiateEmulator } from './core.mjs';
import { emulatorClientConfig, WasmRequestHandler } from './handler.mjs';
import { createWasi } from './wasi.mjs';

/** The wasm build that ships with the package (missing in a git checkout until `npm run wasm`). */
export const bundledWasm = new URL('../aws-emulator.wasm', import.meta.url);

/**
 * @param {string | URL} [wasmPath] defaults to the wasm in the package
 * @param {{ wasi?: 'node' | 'shim', clock?: 'virtual' | 'real' }} [options]
 *   wasi: 'node' uses node:wasi (real clocks); 'shim' uses the same WASI code as the browser.
 */
export async function loadEmulator(wasmPath = bundledWasm, options = {}) {
  const module = await WebAssembly.compile(await readFile(wasmPath));
  let emulator;
  if ((options.wasi ?? 'node') === 'shim') {
    emulator = await instantiateEmulator(module, createWasi({ clock: options.clock }));
  } else {
    const wasi = new WASI({ version: 'preview1', args: ['aws-emulator'], env: {}, returnOnExit: true });
    emulator = await instantiateEmulator(module, {
      imports: wasi.getImportObject(),
      initialize: (instance) => wasi.initialize(instance),
    });
  }
  const requestHandler = new WasmRequestHandler(emulator, { responseBody: nodeResponseBody });
  return Object.assign(emulator, {
    requestHandler,
    /** SDK client settings that send every call to this emulator. */
    clientConfig: (overrides) => emulatorClientConfig(requestHandler, overrides),
  });
}

/** Response bodies as the Node SDK expects them for streaming outputs (S3 GetObject). */
export const nodeResponseBody = (bytes) => Readable.from([Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)]);
