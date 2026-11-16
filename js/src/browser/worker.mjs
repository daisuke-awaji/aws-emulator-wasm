// The Web Worker that owns one emulator instance. Messages:
//   in:  { type: 'init', wasmUrl, clock, persist?: { name } }
//   out: { type: 'ready', fetchCompileMs, instantiateMs, persistence } | { type: 'init-error', message }
//   in:  { type: 'request', id, frame: ArrayBuffer }  out: { type: 'response', id, frame } | { type: 'response', id, error, fatal }
//   in:  { type: 'flush', id? }                       out: { type: 'flushed', id } (when id is given)
//   out: { type: 'log', stream, line } | { type: 'saved', at, ms, bytes, generation, requests } | { type: 'save-error', message }
//   (requests: how many requests this page had answered when the snapshot was taken)
// Requests are served one at a time, in the order they arrive.
//
// With `persist`, the Worker restores the newest snapshot of this wasm build from OPFS
// before it answers anything, and saves a new one once requests stop coming for a moment
// (see store.mjs and snapshot-format.mjs).
import { instantiateEmulator } from '../core.mjs';
import { encodeSnapshot, sha256 } from '../snapshot-format.mjs';
import { createWasi } from '../wasi.mjs';
import { openStore } from './store.mjs';

// Save this long after the last request: one Todo change is several SDK calls in a row.
const SAVE_AFTER_IDLE_MS = 100;

let emulator;
let wasi;
let dead;
let store;
let wasmHash;
let dirty = false;
let saveTimer;
let saving; // the save in progress, if any
let answered = 0; // requests answered on this page

const log = (stream, line) => self.postMessage({ type: 'log', stream, line });

async function compile(response) {
  const type = response.headers.get('content-type') ?? '';
  if (type.startsWith('application/wasm') && WebAssembly.compileStreaming) {
    return WebAssembly.compileStreaming(response);
  }
  return WebAssembly.compile(await response.arrayBuffer());
}

/** Opens the store and finds a snapshot; any failure leaves persistence off for this page. */
async function openPersistence(name, hashing) {
  try {
    store = await openStore(name);
    wasmHash = await hashing;
    return await store.load(wasmHash);
  } catch (error) {
    store = undefined;
    log('stderr', `persistence is off: ${error?.name ?? 'Error'}: ${error?.message ?? error}`);
    return { unavailable: true };
  }
}

async function boot(module, clock, found) {
  if (found?.snapshot) {
    try {
      wasi = createWasi({ clock, log, resume: found.snapshot.clock });
      emulator = await instantiateEmulator(module, wasi);
      emulator.restore(found.snapshot.memory);
      return { restored: true, savedAt: found.snapshot.header.savedAt, discarded: found.discarded };
    } catch (error) {
      log('stderr', `could not restore the snapshot, starting empty: ${error?.message ?? error}`);
      found = { discarded: 'corrupt' };
    }
  }
  wasi = createWasi({ clock, log });
  emulator = await instantiateEmulator(module, wasi);
  return { restored: false, discarded: found?.discarded };
}

function scheduleSave() {
  if (!store) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_AFTER_IDLE_MS);
}

/** Saves now if anything changed since the last save; resolves when written. */
async function save() {
  clearTimeout(saveTimer);
  if (saving) await saving;
  // Never save the memory of an instance that trapped: it may be half-way through a change.
  if (!store || !dirty || !emulator) return;
  dirty = false;
  const started = performance.now();
  // Copying is the only part that holds up requests; compression and the write run after.
  const memory = emulator.snapshot();
  const clockState = wasi.clockState;
  const generation = store.nextGeneration;
  const requests = answered;
  saving = (async () => {
    try {
      const bytes = await encodeSnapshot({ memory, clock: clockState, wasm: wasmHash, generation });
      await store.save(bytes);
      self.postMessage({ type: 'saved', at: new Date().toISOString(), ms: performance.now() - started, bytes: bytes.length, generation, requests });
    } catch (error) {
      dirty = true; // try again after the next request
      self.postMessage({ type: 'save-error', message: `${error?.name ?? 'Error'}: ${error?.message ?? error}` });
    } finally {
      saving = undefined;
    }
  })();
  await saving;
}

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      const started = performance.now();
      const response = await fetch(data.wasmUrl);
      if (!response.ok) throw new Error(`GET ${data.wasmUrl}: ${response.status} ${response.statusText}`);
      // The snapshot is only good for the build that wrote it, so persistence needs its hash.
      const hashing = data.persist ? response.clone().arrayBuffer().then(sha256) : undefined;
      const [module, found] = await Promise.all([
        compile(response),
        data.persist ? openPersistence(data.persist.name, hashing) : undefined,
      ]);
      const compiled = performance.now();
      const restored = await boot(module, data.clock, found);
      self.postMessage({
        type: 'ready',
        fetchCompileMs: compiled - started,
        instantiateMs: performance.now() - compiled,
        persistence: data.persist ? { enabled: !!store, ...restored } : undefined,
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
      // Even a read changes the memory (allocator, request ids), so every request counts.
      answered += 1;
      dirty = true;
      scheduleSave();
      self.postMessage({ type: 'response', id: data.id, frame: out.buffer, skippedMs: wasi.skippedMs }, [out.buffer]);
    } catch (error) {
      // A trap (a Rust panic aborts) leaves the instance unusable.
      dead = `the emulator crashed: ${error?.message ?? error}`;
      emulator = undefined;
      self.postMessage({ type: 'response', id: data.id, error: dead, fatal: true });
    }
    return;
  }

  if (data.type === 'flush') {
    await save();
    if (data.id !== undefined) self.postMessage({ type: 'flushed', id: data.id });
  }
};
