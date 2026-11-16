// Runs the emulator in a Web Worker and gives AWS SDK v3 clients a request handler for it.
//
//   import { createEmulator } from 'aws-emulator-wasm/browser';
//   const emulator = createEmulator({ wasmUrl: '/aws-emulator.wasm' });
//   const ddb = new DynamoDBClient(emulator.clientConfig());
//
// Nothing goes over the network except the one download of the wasm file.
import { decodeResponse, encodeRequest } from '../codec.mjs';
import { WasmRequestHandler } from '../handler.mjs';

/**
 * @param {{
 *   wasmUrl: string | URL,
 *   worker?: Worker,
 *   clock?: 'virtual' | 'real',
 *   onLog?: (stream: 'stdout' | 'stderr', line: string) => void,
 * }} options
 */
export function createEmulator(options) {
  const worker = options.worker ?? new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module', name: 'aws-emulator' });
  const pending = new Map();
  let nextId = 1;
  let fatal;
  const stats = { requests: 0, skippedMs: 0, fetchCompileMs: undefined, instantiateMs: undefined };

  let markReady;
  let markFailed;
  const ready = new Promise((resolve, reject) => {
    markReady = resolve;
    markFailed = reject;
  });
  ready.catch(() => {}); // callers see the failure through fetch(); do not report it as unhandled

  const fail = (message) => {
    fatal = new Error(message);
    markFailed(fatal);
    for (const { reject } of pending.values()) reject(fatal);
    pending.clear();
  };

  worker.onmessage = ({ data }) => {
    switch (data.type) {
      case 'ready':
        stats.fetchCompileMs = data.fetchCompileMs;
        stats.instantiateMs = data.instantiateMs;
        markReady(stats);
        break;
      case 'init-error':
        fail(data.message);
        break;
      case 'log':
        options.onLog?.(data.stream, data.line);
        break;
      case 'response': {
        const call = pending.get(data.id);
        pending.delete(data.id);
        if (data.fatal) fail(data.error);
        if (!call) break;
        if (data.error) call.reject(fatal ?? new Error(data.error));
        else {
          stats.requests += 1;
          stats.skippedMs = data.skippedMs;
          call.resolve(decodeResponse(new Uint8Array(data.frame)));
        }
        break;
      }
    }
  };
  worker.onerror = (event) => fail(`the emulator worker failed: ${event.message ?? 'unknown error'}`);

  const wasmUrl = new URL(options.wasmUrl, globalThis.location?.href).href;
  worker.postMessage({ type: 'init', wasmUrl, clock: options.clock ?? 'virtual' });

  /** @param {{method: string, url: string, headers: [string, string][], body: Uint8Array}} req */
  async function fetch(req) {
    await ready;
    if (fatal) throw fatal;
    const frame = encodeRequest(req);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'request', id, frame: frame.buffer }, [frame.buffer]);
    });
  }

  const requestHandler = new WasmRequestHandler({ fetch });

  return {
    /** Resolves once the wasm is downloaded and instantiated. */
    ready,
    fetch,
    requestHandler,
    stats,
    /** Client settings that send every call to this emulator. */
    clientConfig(overrides = {}) {
      return {
        region: 'us-east-1',
        endpoint: 'http://localhost:4566',
        credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
        requestHandler,
        maxAttempts: 1,
        ...overrides,
      };
    },
    terminate() {
      worker.terminate();
      fail('the emulator was terminated');
    },
  };
}
