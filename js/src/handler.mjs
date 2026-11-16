// An AWS SDK for JavaScript v3 request handler that serves calls from the wasm emulator.
import { HttpResponse } from '@smithy/protocol-http';
import { buildQueryString } from '@smithy/querystring-builder';

const utf8 = new TextEncoder();

async function bodyBytes(body) {
  if (body === undefined || body === null) return new Uint8Array();
  if (typeof body === 'string') return utf8.encode(body);
  if (body instanceof Uint8Array) return body;
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const chunk of body) chunks.push(typeof chunk === 'string' ? utf8.encode(chunk) : chunk);
    return Uint8Array.from(Buffer.concat(chunks));
  }
  throw new TypeError(`unsupported request body: ${Object.prototype.toString.call(body)}`);
}

export function requestUrl(request) {
  const port = request.port ? `:${request.port}` : '';
  const query = buildQueryString(request.query ?? {});
  return `${request.protocol}//${request.hostname}${port}${request.path}${query ? `?${query}` : ''}`;
}

/** @param {{ fetch: Function, tick: Function }} emulator */
export class WasmRequestHandler {
  constructor(emulator) {
    this.emulator = emulator;
  }

  async handle(request) {
    const res = this.emulator.fetch({
      method: request.method,
      url: requestUrl(request),
      headers: Object.entries(request.headers),
      body: await bodyBytes(request.body),
    });
    this.emulator.tick();
    const headers = {};
    for (const [name, value] of res.headers) {
      headers[name] = name in headers ? `${headers[name]}, ${value}` : value;
    }
    return { response: new HttpResponse({ statusCode: res.status, headers, body: res.body }) };
  }

  updateHttpClientConfig() {}

  httpHandlerConfigs() {
    return {};
  }
}
