// The Web Worker that owns one emulator instance. Messages:
//   in:  { type: 'init', wasmUrl, clock }            out: { type: 'ready', ms } | { type: 'init-error', message }
//   in:  { type: 'request', id, frame: ArrayBuffer }  out: { type: 'response', id, frame } | { type: 'response', id, error, fatal }
//   out: { type: 'log', stream, line }
// Requests are served one at a time, in the order they arrive.
import { instantiateEmulator } from '../core.mjs';
import { createWasi } from '../wasi.mjs';

let emulator;
let wasi;
let dead;

async function compile(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url}: ${response.status} ${response.statusText}`);
  const type = response.headers.get('content-type') ?? '';
  if (type.startsWith('application/wasm') && WebAssembly.compileStreaming) {
    return WebAssembly.compileStreaming(response);
  }
  return WebAssembly.compile(await response.arrayBuffer());
}

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      const started = performance.now();
      const module = await compile(data.wasmUrl);
      const compiled = performance.now();
      wasi = createWasi({
        clock: data.clock,
        log: (stream, line) => self.postMessage({ type: 'log', stream, line }),
      });
      emulator = await instantiateEmulator(module, wasi);
      self.postMessage({
        type: 'ready',
        fetchCompileMs: compiled - started,
        instantiateMs: performance.now() - compiled,
      });
    } catch (error) {
      self.postMessage({ type: 'init-error', message: String(error?.stack ?? error) });
    }
    return;
  }

  if (data.type === 'request') {
    if (!emulator) {
      self.postMessage({ type: 'response', id: data.id, error: dead ?? 'the emulator is not loaded', fatal: true });
      return;
    }
    try {
      const out = emulator.handleFrame(new Uint8Array(data.frame));
      self.postMessage({ type: 'response', id: data.id, frame: out.buffer, skippedMs: wasi.skippedMs }, [out.buffer]);
    } catch (error) {
      // A trap (a Rust panic aborts) leaves the instance unusable.
      dead = `the emulator crashed: ${error?.message ?? error}`;
      emulator = undefined;
      self.postMessage({ type: 'response', id: data.id, error: dead, fatal: true });
    }
  }
};
