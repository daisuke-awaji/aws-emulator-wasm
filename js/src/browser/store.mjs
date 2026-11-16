// Keeps emulator snapshots in the origin private file system (OPFS), under
// aws-emulator-wasm/<name>/. There are two slots, written in turn: a save never overwrites
// the newest good snapshot, so a tab closed in the middle of a write loses only that write.
import { decodeSnapshot, readSnapshotHeader, SnapshotError } from '../snapshot-format.mjs';

const ROOT = 'aws-emulator-wasm';
const SLOTS = [0, 1];
const slotFile = (slot) => `slot-${slot}.snapshot`;

async function directory(name, create) {
  const root = await navigator.storage.getDirectory();
  const top = await root.getDirectoryHandle(ROOT, { create });
  return top.getDirectoryHandle(name, { create });
}

async function writeFile(dir, file, bytes) {
  const handle = await dir.getFileHandle(file, { create: true });
  if (typeof handle.createSyncAccessHandle === 'function') {
    // Workers only; Chrome 102, Firefox 111, Safari 16.4.
    const access = await handle.createSyncAccessHandle();
    try {
      access.truncate(0);
      let at = 0;
      while (at < bytes.length) at += access.write(bytes.subarray(at), { at });
      access.flush();
    } finally {
      access.close();
    }
    return;
  }
  const writable = await handle.createWritable();
  await writable.write(bytes);
  await writable.close();
}

async function readFile(dir, file) {
  try {
    const handle = await dir.getFileHandle(file);
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  } catch (error) {
    if (error?.name === 'NotFoundError') return undefined;
    throw error;
  }
}

/**
 * Opens (creating if needed) the store for one emulator.
 * @param {string} name
 */
export async function openStore(name) {
  const dir = await directory(name, true);
  let nextSlot = 0;
  let nextGeneration = 1;

  return {
    /**
     * Finds the newest snapshot this wasm build can read. Snapshots of another build are
     * deleted; a torn one is skipped (and overwritten by a later save).
     * @param {string} wasm SHA-256 of the running wasm build
     * @returns {Promise<{ snapshot?: { header: object, memory: Uint8Array, clock: object },
     *   discarded?: 'version' | 'corrupt' }>}
     */
    async load(wasm) {
      const found = [];
      let corrupt = false;
      let version = false;
      for (const slot of SLOTS) {
        const bytes = await readFile(dir, slotFile(slot));
        if (!bytes) continue;
        try {
          found.push({ slot, bytes, generation: readSnapshotHeader(bytes).header.generation });
        } catch (error) {
          if (!(error instanceof SnapshotError)) throw error;
          if (error.reason === 'version') version = true;
          else corrupt = true;
          if (error.reason === 'version') await dir.removeEntry(slotFile(slot));
        }
      }
      found.sort((a, b) => b.generation - a.generation);
      if (found.length) nextGeneration = found[0].generation + 1;
      for (const entry of found) {
        try {
          const snapshot = await decodeSnapshot(entry.bytes, wasm);
          nextSlot = 1 - entry.slot;
          return { snapshot, discarded: corrupt ? 'corrupt' : undefined };
        } catch (error) {
          if (!(error instanceof SnapshotError)) throw error;
          if (error.reason === 'version') {
            version = true;
            await dir.removeEntry(slotFile(entry.slot));
          } else {
            corrupt = true;
          }
        }
      }
      return { discarded: version ? 'version' : corrupt ? 'corrupt' : undefined };
    },

    /** The generation number the next save should carry. */
    get nextGeneration() {
      return nextGeneration;
    },

    /** Writes an encoded snapshot (see snapshot-format.mjs) into the older slot. */
    async save(bytes) {
      await writeFile(dir, slotFile(nextSlot), bytes);
      nextSlot = 1 - nextSlot;
      nextGeneration += 1;
    },
  };
}

/** Deletes every snapshot of one emulator. Works on the main thread too. */
export async function deleteSnapshots(name) {
  const root = await navigator.storage.getDirectory();
  let top;
  try {
    top = await root.getDirectoryHandle(ROOT);
  } catch (error) {
    if (error?.name === 'NotFoundError') return;
    throw error;
  }
  // A Worker that was just terminated may still hold a file open for a moment.
  for (let attempt = 0; ; attempt++) {
    try {
      await top.removeEntry(name, { recursive: true });
      return;
    } catch (error) {
      if (error?.name === 'NotFoundError') return;
      if (attempt >= 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
