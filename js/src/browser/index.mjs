// Runs the emulator in a Web Worker and gives AWS SDK v3 clients a request handler for it.
//
//   import { createEmulator } from 'aws-emulator-wasm/browser';
//   import wasmUrl from 'aws-emulator-wasm/aws-emulator.wasm?url'; // Vite; or any URL of the file
//   const emulator = createEmulator({ wasmUrl });
//   const ddb = new DynamoDBClient(emulator.clientConfig());
//
// Nothing goes over the network except the one download of the wasm file.
//
// With `persist: { name }`, the emulator's state survives a reload: the Worker saves a
// snapshot of the wasm memory to OPFS when requests pause, and restores it on the next
// load (same wasm build only; another build starts empty). Only one tab at a time runs a
// persisted emulator of a given name (Web Locks); the others wait, or take it over.
import { decodeResponse, encodeRequest } from '../codec.mjs';
import { emulatorClientConfig, WasmRequestHandler } from '../handler.mjs';
import { deleteSnapshots } from './store.mjs';

/**
 * @typedef {'waiting' | 'held' | 'lost'} LockState
 *   waiting: another tab runs this emulator; held: this tab runs it;
 *   lost: another tab took it over, and this tab's emulator was stopped.
 */

/**
 * @param {{
 *   wasmUrl: string | URL,
 *   worker?: Worker,
 *   clock?: 'virtual' | 'real',
 *   persist?: false | { name: string, takeOver?: boolean },
 *   onLog?: (stream: 'stdout' | 'stderr', line: string) => void,
 *   onCall?: (call: {
 *     seq: number, method: string, url: string, headers: [string, string][],
 *     status: number, ms: number, startedAt: number,
 *   }) => void,
 *   onLock?: (state: LockState) => void,
 *   onSave?: (event: { at: string, ms: number, bytes: number, requests: number } | { error: string }) => void,
 * }} options
 *   onCall: called after each request the emulator answers. `seq` matches stats.requests;
 *   `ms` is the time from posting the request to the Worker until its answer arrived.
 *   persist.takeOver: start at once even if another tab runs this emulator (that tab stops).
 */
export function createEmulator(options) {
  const worker = options.worker ?? new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module', name: 'aws-emulator' });
  const persist = options.persist ? { name: options.persist.name } : undefined;
  const pending = new Map();
  const flushes = new Map();
  let nextId = 1;
  let fatal;
  const stats = {
    requests: 0,
    skippedMs: 0,
    fetchCompileMs: undefined,
    instantiateMs: undefined,
    /** With `persist`: { enabled, restored, savedAt?, discarded?: 'version' | 'corrupt', lastSave? } */
    persistence: undefined,
  };

  let markReady;
  let markFailed;
  const ready = new Promise((resolve, reject) => {
    markReady = resolve;
    markFailed = reject;
  });
  ready.catch(() => {}); // callers see the failure through fetch(); do not report it as unhandled

  const fail = (message) => {
    if (fatal) return;
    fatal = new Error(message);
    markFailed(fatal);
    for (const { reject } of pending.values()) reject(fatal);
    pending.clear();
    for (const resolve of flushes.values()) resolve();
    flushes.clear();
  };

  worker.onmessage = ({ data }) => {
    switch (data.type) {
      case 'ready':
        stats.fetchCompileMs = data.fetchCompileMs;
        stats.instantiateMs = data.instantiateMs;
        stats.persistence = data.persistence;
        markReady(stats);
        break;
      case 'init-error':
        fail(data.message);
        break;
      case 'log':
        options.onLog?.(data.stream, data.line);
        break;
      case 'saved':
        // requests: the save covers this many answered requests (compare stats.requests).
        if (stats.persistence) stats.persistence.lastSave = { at: data.at, ms: data.ms, bytes: data.bytes, requests: data.requests };
        options.onSave?.({ at: data.at, ms: data.ms, bytes: data.bytes, requests: data.requests });
        break;
      case 'save-error':
        options.onSave?.({ error: data.message });
        options.onLog?.('stderr', `could not save the emulator: ${data.message}`);
        break;
      case 'flushed':
        flushes.get(data.id)?.();
        flushes.delete(data.id);
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
          const res = decodeResponse(new Uint8Array(data.frame));
          if (options.onCall) {
            const { req, startedAt } = call;
            try {
              options.onCall({
                seq: stats.requests,
                method: req.method,
                url: req.url,
                headers: req.headers,
                status: res.status,
                ms: performance.now() - startedAt,
                startedAt,
              });
            } catch (error) {
              console.error('onCall threw', error);
            }
          }
          call.resolve(res);
        }
        break;
      }
    }
  };
  worker.onerror = (event) => fail(`the emulator worker failed: ${event.message ?? 'unknown error'}`);

  const wasmUrl = new URL(options.wasmUrl, globalThis.location?.href).href;
  const start = () => worker.postMessage({ type: 'init', wasmUrl, clock: options.clock ?? 'virtual', persist });

  // --- One tab per persisted emulator -------------------------------------------------
  let lockState;
  let releaseLock; // resolves the callback that holds the lock
  let waiting; // AbortController of the queued request, while another tab holds the lock
  let started = false;
  const setLock = (state) => {
    lockState = state;
    options.onLock?.(state);
  };

  /** Asks for the lock; `steal` takes it from the tab that has it. */
  function requestLock({ steal = false, ifAvailable = false, signal } = {}) {
    return navigator.locks
      .request(`aws-emulator-wasm:${persist.name}`, { steal, ifAvailable, signal }, (lock) => {
        if (!lock) return false;
        // Cancel the queued request, unless that is the one being granted now.
        if (waiting && waiting.signal !== signal) waiting.abort();
        waiting = undefined;
        setLock('held');
        if (!started) {
          started = true;
          start();
        }
        return new Promise((resolve) => {
          releaseLock = () => resolve(true);
        });
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') throw error;
        // Our own queued request, cancelled because we took the lock another way.
        if (signal?.aborted) return true;
        // Another tab stole the lock: stop before it saves over that tab's state.
        if (lockState === 'held') {
          setLock('lost');
          worker.terminate();
          fail('another tab took over this emulator');
        }
        return true;
      });
  }

  if (!persist) {
    start();
  } else if (!globalThis.navigator?.locks) {
    // No Web Locks (e.g. not a secure context): run anyway; two tabs would overwrite each other.
    options.onLog?.('stderr', 'Web Locks are not available; another tab may overwrite the saved state');
    start();
  } else if (options.persist.takeOver) {
    requestLock({ steal: true });
  } else {
    requestLock({ ifAvailable: true }).then((got) => {
      if (got !== false || fatal) return;
      setLock('waiting');
      waiting = new AbortController();
      requestLock({ signal: waiting.signal });
    });
  }

  // A tab being hidden may be the last chance to save (mobile browsers kill background tabs).
  const onHidden = () => {
    if (document.visibilityState === 'hidden' && persist && !fatal) worker.postMessage({ type: 'flush' });
  };
  if (persist && globalThis.document) document.addEventListener('visibilitychange', onHidden);

  /** @param {{method: string, url: string, headers: [string, string][], body: Uint8Array}} req */
  async function fetch(req) {
    await ready;
    if (fatal) throw fatal;
    const frame = encodeRequest(req);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, req, startedAt: performance.now() });
      worker.postMessage({ type: 'request', id, frame: frame.buffer }, [frame.buffer]);
    });
  }

  const requestHandler = new WasmRequestHandler({ fetch });

  const stop = (message) => {
    globalThis.document?.removeEventListener('visibilitychange', onHidden);
    worker.terminate();
    fail(message);
  };
  const unlock = () => {
    releaseLock?.();
    waiting?.abort();
  };

  return {
    /** Resolves once the wasm is downloaded and instantiated (and, with `persist`, restored). */
    ready,
    fetch,
    requestHandler,
    stats,
    /** Client settings that send every call to this emulator. */
    clientConfig(overrides = {}) {
      return emulatorClientConfig(requestHandler, overrides);
    },
    /** With `persist`: 'waiting' | 'held' | 'lost' (undefined without Web Locks). */
    get lock() {
      return lockState;
    },
    /** While waiting for another tab: take the emulator over (that tab stops). */
    takeOver() {
      if (lockState !== 'waiting') return;
      requestLock({ steal: true });
    },
    /** Resolves when everything answered so far is saved (at once without `persist`). */
    async flush() {
      if (!persist) return;
      await ready.catch(() => {});
      if (fatal) return;
      const id = nextId++;
      await new Promise((resolve) => {
        flushes.set(id, resolve);
        worker.postMessage({ type: 'flush', id });
      });
    },
    /**
     * Stops the emulator and deletes its saved state. Reload the page afterwards to start
     * from empty.
     */
    async reset() {
      stop('the emulator was reset');
      try {
        // Delete before letting a waiting tab in, so it does not restore what is going away.
        if (persist) await deleteSnapshots(persist.name);
      } finally {
        unlock();
      }
    },
    terminate() {
      stop('the emulator was terminated');
      unlock();
    },
  };
}
