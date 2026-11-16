// Unit tests of the WASI shim against a bare memory (no wasm module needed).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWasi, WasiExit } from '../src/wasi.mjs';

function setup(options) {
  const wasi = createWasi({ log: () => {}, ...options });
  const memory = new WebAssembly.Memory({ initial: 3 });
  wasi.initialize({ exports: { memory } });
  return { wasi, w: wasi.imports.wasi_snapshot_preview1, view: new DataView(memory.buffer), memory };
}

/** Writes one relative clock subscription at 0 and polls it; returns [errno, events]. */
function sleep(w, view, ns, userdata = 7n) {
  view.setBigUint64(0, userdata, true);
  view.setUint8(8, 0); // clock
  view.setUint32(16, 1, true); // monotonic
  view.setBigUint64(24, ns, true);
  view.setUint16(40, 0, true); // relative
  const errno = w.poll_oneoff(0, 100, 1, 200);
  return [errno, view.getUint32(200, true)];
}

const clock = (w, view, id) => {
  assert.equal(w.clock_time_get(id, 0n, 300), 0);
  return view.getBigUint64(300, true);
};

test('virtual clock: a sleep returns at once and moves the clocks forward', () => {
  const { wasi, w, view } = setup();
  const before = clock(w, view, 0);
  const started = performance.now();
  const [errno, events] = sleep(w, view, 3_000_000_000n);
  assert.ok(performance.now() - started < 100);
  assert.equal(errno, 0);
  assert.equal(events, 1);
  assert.equal(view.getBigUint64(100, true), 7n); // userdata
  assert.equal(view.getUint16(108, true), 0); // error
  assert.ok(wasi.skippedMs >= 2999 && wasi.skippedMs <= 3000);
  assert.ok(clock(w, view, 0) - before >= 3_000_000_000n);
});

test('real clock: a sleep blocks', () => {
  const { wasi, w, view } = setup({ clock: 'real' });
  const started = performance.now();
  sleep(w, view, 50_000_000n);
  assert.ok(performance.now() - started >= 45);
  assert.equal(wasi.skippedMs, 0);
});

test('monotonic clock: counts from the UNIX epoch and carries over with resume', () => {
  const a = setup();
  const epoch = BigInt(Math.floor(performance.timeOrigin + performance.now())) * 1_000_000n;
  const t0 = clock(a.w, a.view, 1);
  assert.ok(t0 - epoch >= 0n && t0 - epoch < 1_000_000_000n);
  sleep(a.w, a.view, 3_000_000_000n);
  const state = a.wasi.clockState;
  assert.ok(state.skippedNs >= 2_999_000_000n);
  // The next page: the clock goes on from the last reading, skipped time included.
  const b = setup({ resume: state });
  const t1 = clock(b.w, b.view, 1);
  assert.ok(t1 >= state.monotonicNs);
  assert.ok(t1 - state.monotonicNs < 1_000_000_000n);
  assert.equal(b.wasi.skippedMs, a.wasi.skippedMs);
});

test('monotonic clock: does not go back when the system clock is behind the saved state', () => {
  const ahead = { skippedNs: 0n, monotonicNs: BigInt(Math.floor(performance.timeOrigin + performance.now())) * 1_000_000n + 3_600_000_000_000n };
  const { w, view } = setup({ resume: ahead });
  const t1 = clock(w, view, 1);
  assert.ok(t1 >= ahead.monotonicNs);
  const t2 = clock(w, view, 1);
  assert.ok(t2 >= t1);
});

test('random_get fills more than 64 KiB', () => {
  const { w, memory } = setup();
  assert.equal(w.random_get(0, 65536 * 2), 0);
  const bytes = new Uint8Array(memory.buffer, 65536, 65536);
  assert.ok(bytes.some((b) => b !== 0));
});

test('stdout is line-buffered into the log; other fds are rejected', () => {
  const lines = [];
  const wasi = createWasi({ log: (stream, line) => lines.push([stream, line]) });
  const memory = new WebAssembly.Memory({ initial: 3 });
  wasi.initialize({ exports: { memory } });
  const w = wasi.imports.wasi_snapshot_preview1;
  const view = new DataView(memory.buffer);
  new Uint8Array(memory.buffer).set(new TextEncoder().encode('ab\ncd'), 1000);
  view.setUint32(0, 1000, true);
  view.setUint32(4, 5, true);
  assert.equal(w.fd_write(2, 0, 1, 16), 0);
  assert.equal(view.getUint32(16, true), 5);
  assert.deepEqual(lines, [['stderr', 'ab']]);
  assert.equal(w.fd_write(5, 0, 1, 16), 8);
  assert.equal(w.path_open(3, 0, 0, 0, 0, 0n, 0n, 0, 0), 76);
  assert.equal(w.fd_prestat_get(3, 0), 8);
});

test('proc_exit throws WasiExit', () => {
  const { w } = setup();
  assert.throws(() => w.proc_exit(3), (e) => e instanceof WasiExit && e.code === 3);
});

test('functions the shim does not implement answer ENOSYS', () => {
  const { w } = setup();
  assert.equal(w.fd_seek(1, 0n, 0, 0), 70);
  assert.equal(w.fd_seek(9, 0n, 0, 0), 8);
  assert.equal(w.sock_accept(3, 0, 0), 52);
  assert.equal(typeof w.path_unlink_file, 'function');
});
