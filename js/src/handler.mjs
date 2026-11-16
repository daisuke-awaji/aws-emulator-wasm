// An AWS SDK for JavaScript v3 request handler that serves calls from the wasm emulator.
// It works with any emulator whose fetch(req) returns a response (or a promise of one):
// the Node loader (emulator.mjs) or the browser Worker client (browser/index.mjs).
import { HttpResponse } from '@smithy/protocol-http';
import { buildQueryString } from '@smithy/querystring-builder';

const utf8 = new TextEncoder();

function concat(chunks) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export async function bodyBytes(body) {
  if (body === undefined || body === null) return new Uint8Array();
  if (typeof body === 'string') return utf8.encode(body);
  if (body instanceof Uint8Array) return body;
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof Blob === 'function' && body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (typeof ReadableStream === 'function' && body instanceof ReadableStream) {
    return new Uint8Array(await new Response(body).arrayBuffer());
  }
  if (typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const chunk of body) chunks.push(typeof chunk === 'string' ? utf8.encode(chunk) : new Uint8Array(chunk));
    return concat(chunks);
  }
  throw new TypeError(`unsupported request body: ${Object.prototype.toString.call(body)}`);
}

export function requestUrl(request) {
  const port = request.port ? `:${request.port}` : '';
  const query = buildQueryString(request.query ?? {});
  return `${request.protocol}//${request.hostname}${port}${request.path}${query ? `?${query}` : ''}`;
}

/**
 * Browsers: a ReadableStream, the type the SDK's browser stream helpers expect for
 * streaming outputs (S3 GetObject; its checksum validation does not accept a Blob).
 * Elsewhere: the bytes as they are (Node callers pass nodeResponseBody for streams).
 */
const defaultResponseBody = (bytes) =>
  typeof ReadableStream === 'function' && typeof process === 'undefined' ? new Blob([bytes]).stream() : bytes;

export class WasmRequestHandler {
  /**
   * @param {{ fetch: (req: {method: string, url: string, headers: [string, string][], body: Uint8Array}) => any }} emulator
   * @param {{ responseBody?: (bytes: Uint8Array) => any }} [options]
   */
  constructor(emulator, options = {}) {
    this.emulator = emulator;
    this.responseBody = options.responseBody ?? defaultResponseBody;
  }

  async handle(request, { abortSignal } = {}) {
    if (abortSignal?.aborted) {
      const error = new Error('Request aborted');
      error.name = 'AbortError';
      throw error;
    }
    const res = await this.emulator.fetch({
      method: request.method,
      url: requestUrl(request),
      headers: Object.entries(request.headers),
      body: await bodyBytes(request.body),
    });
    const headers = {};
    for (const [name, value] of res.headers) {
      headers[name] = name in headers ? `${headers[name]}, ${value}` : value;
    }
    return { response: new HttpResponse({ statusCode: res.status, headers, body: this.responseBody(res.body) }) };
  }

  updateHttpClientConfig() {}

  httpHandlerConfigs() {
    return {};
  }
}
