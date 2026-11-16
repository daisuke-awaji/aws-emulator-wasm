// The saved snapshot format: round trip, a torn file, another wasm build.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeSnapshot, encodeSnapshot, readSnapshotHeader, SnapshotError } from '../src/snapshot-format.mjs';

const memory = new Uint8Array(65536 * 3);
memory.set([1, 2, 3], 70000);
const clock = { skippedNs: 3_000_000_000n, monotonicNs: 1_763_000_000_000_000_000n };
const save = () => encodeSnapshot({ memory, clock, wasm: 'aa', generation: 7, savedAt: '2026-11-16T10:00:00.000Z' });

test('round trip', async () => {
  const bytes = await save();
  assert.ok(bytes.length < 2000); // mostly zeros
  const { header, memory: back, clock: c } = await decodeSnapshot(bytes, 'aa');
  assert.equal(header.generation, 7);
  assert.equal(header.savedAt, '2026-11-16T10:00:00.000Z');
  assert.deepEqual(back, memory);
  assert.deepEqual(c, clock);
});

test('another wasm build is refused as "version"', async () => {
  await assert.rejects(decodeSnapshot(await save(), 'bb'), (e) => e instanceof SnapshotError && e.reason === 'version');
});

test('a torn or altered file is refused as "corrupt"', async () => {
  const bytes = await save();
  for (const broken of [bytes.subarray(0, bytes.length - 10), bytes.subarray(0, 20), new Uint8Array(0)]) {
    await assert.rejects(decodeSnapshot(broken, 'aa'), (e) => e instanceof SnapshotError && e.reason === 'corrupt');
  }
  const altered = bytes.slice();
  altered[altered.length - 20] ^= 0xff;
  await assert.rejects(decodeSnapshot(altered, 'aa'), (e) => e.reason === 'corrupt');
  assert.equal(readSnapshotHeader(altered).header.generation, 7); // the header alone still reads
});
