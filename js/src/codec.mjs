// The frame format shared with crates/wasm-host/src/lib.rs:
// u32 count, then count x (u32 len, len bytes), all little-endian.

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

/** @param {(Uint8Array|string)[]} fields */
export function encodeFields(fields) {
  const bytes = fields.map((f) => (typeof f === 'string' ? utf8.encode(f) : f));
  const out = new Uint8Array(4 + bytes.reduce((n, b) => n + 4 + b.length, 0));
  const view = new DataView(out.buffer);
  view.setUint32(0, bytes.length, true);
  let at = 4;
  for (const b of bytes) {
    view.setUint32(at, b.length, true);
    out.set(b, at + 4);
    at += 4 + b.length;
  }
  return out;
}

/** @param {Uint8Array} buf @returns {Uint8Array[]} */
export function decodeFields(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const take = (at) => {
    if (at + 4 > buf.length) throw new Error('malformed frame');
    return view.getUint32(at, true);
  };
  const count = take(0);
  const fields = [];
  let at = 4;
  for (let i = 0; i < count; i++) {
    const len = take(at);
    if (at + 4 + len > buf.length) throw new Error('malformed frame');
    fields.push(buf.subarray(at + 4, at + 4 + len));
    at += 4 + len;
  }
  if (at !== buf.length) throw new Error('malformed frame');
  return fields;
}

/**
 * @param {{method: string, url: string, headers: [string, string][], body: Uint8Array}} req
 */
export function encodeRequest({ method, url, headers, body }) {
  return encodeFields([method, url, ...headers.flat(), body]);
}

/** @returns {{status: number, headers: [string, string][], body: Uint8Array}} */
export function decodeResponse(buf) {
  const fields = decodeFields(buf);
  if (fields.length < 2 || fields.length % 2 !== 0) {
    throw new Error(`response frame has ${fields.length} fields`);
  }
  const headers = [];
  for (let i = 1; i < fields.length - 1; i += 2) {
    headers.push([fromUtf8.decode(fields[i]), fromUtf8.decode(fields[i + 1])]);
  }
  return {
    status: Number(fromUtf8.decode(fields[0])),
    headers,
    body: fields[fields.length - 1],
  };
}
