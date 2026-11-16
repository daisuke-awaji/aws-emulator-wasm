// The saved form of an emulator snapshot: a small JSON header and the gzipped wasm memory.
//
//   "AEWS" | u32 LE header length | header (UTF-8 JSON) | gzip(memory)
//
// The header names the wasm build (SHA-256 of the .wasm file): memory from another build
// cannot be read. It also carries the WASI clock state and a SHA-256 of the gzip body, so
// a file torn by a crash is recognised and skipped. Platform-neutral (Web Streams and Web
// Crypto, which browsers and Node 22 both have).

const MAGIC = [0x41, 0x45, 0x57, 0x53]; // AEWS
export const SNAPSHOT_FORMAT = 1;

export class SnapshotError extends Error {
  /** @param {'corrupt' | 'version'} reason */
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** SHA-256 of some bytes, as lowercase hex. */
export async function sha256(bytes) {
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}

async function pipe(bytes, transform) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer());
}

/**
 * @param {{ memory: Uint8Array, clock: { skippedNs: bigint, monotonicNs: bigint },
 *   wasm: string, generation: number, savedAt?: string }} snapshot
 * @returns {Promise<Uint8Array>}
 */
export async function encodeSnapshot({ memory, clock, wasm, generation, savedAt = new Date().toISOString() }) {
  const body = await pipe(memory, new CompressionStream('gzip'));
  const header = new TextEncoder().encode(JSON.stringify({
    format: SNAPSHOT_FORMAT,
    wasm,
    generation,
    savedAt,
    skippedNs: String(clock.skippedNs),
    monotonicNs: String(clock.monotonicNs),
    memoryBytes: memory.length,
    bodyBytes: body.length,
    bodySha256: await sha256(body),
  }));
  const out = new Uint8Array(8 + header.length + body.length);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, header.length, true);
  out.set(header, 8);
  out.set(body, 8 + header.length);
  return out;
}

/** Reads only the header; throws SnapshotError('corrupt') if it cannot. */
export function readSnapshotHeader(bytes) {
  if (bytes.length < 8 || MAGIC.some((b, i) => bytes[i] !== b)) throw new SnapshotError('corrupt', 'not a snapshot file');
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  if (8 + length > bytes.length) throw new SnapshotError('corrupt', 'the header is cut off');
  let header;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length)));
  } catch {
    throw new SnapshotError('corrupt', 'the header is not JSON');
  }
  if (header?.format !== SNAPSHOT_FORMAT) throw new SnapshotError('version', `snapshot format ${header?.format}, expected ${SNAPSHOT_FORMAT}`);
  return { header, body: bytes.subarray(8 + length) };
}

/**
 * @param {Uint8Array} bytes
 * @param {string} wasm SHA-256 of the running wasm build
 * @returns {Promise<{ header: object, memory: Uint8Array, clock: { skippedNs: bigint, monotonicNs: bigint } }>}
 */
export async function decodeSnapshot(bytes, wasm) {
  const { header, body } = readSnapshotHeader(bytes);
  if (header.wasm !== wasm) throw new SnapshotError('version', 'saved by another wasm build');
  if (body.length !== header.bodyBytes || (await sha256(body)) !== header.bodySha256) {
    throw new SnapshotError('corrupt', 'the body does not match its checksum');
  }
  let memory;
  try {
    memory = await pipe(body, new DecompressionStream('gzip'));
  } catch {
    throw new SnapshotError('corrupt', 'the body does not decompress');
  }
  if (memory.length !== header.memoryBytes) throw new SnapshotError('corrupt', 'the memory has the wrong size');
  return { header, memory, clock: { skippedNs: BigInt(header.skippedNs), monotonicNs: BigInt(header.monotonicNs) } };
}
