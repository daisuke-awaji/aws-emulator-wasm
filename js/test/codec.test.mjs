import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeFields, decodeResponse, encodeFields, encodeRequest } from '../src/codec.mjs';
import { requestUrl } from '../src/handler.mjs';

test('fields round-trip, including empty and binary fields', () => {
  const fields = [new Uint8Array([0x50]), new Uint8Array(), new Uint8Array([0, 255])];
  assert.deepEqual(decodeFields(encodeFields(fields)), fields);
});

test('truncated and trailing frames are rejected', () => {
  const frame = encodeFields(['abc']);
  assert.throws(() => decodeFields(frame.subarray(0, frame.length - 1)));
  assert.throws(() => decodeFields(Uint8Array.from([...frame, 0])));
  assert.throws(() => decodeFields(new Uint8Array([1, 0, 0])));
});

test('a request frame is method, url, header pairs, body', () => {
  const frame = encodeRequest({
    method: 'POST',
    url: 'http://h/',
    headers: [['x-a', '1']],
    body: new Uint8Array([7]),
  });
  const text = decodeFields(frame).slice(0, 4).map((f) => new TextDecoder().decode(f));
  assert.deepEqual(text, ['POST', 'http://h/', 'x-a', '1']);
});

test('a response frame decodes to status, headers, body', () => {
  const res = decodeResponse(encodeFields(['201', 'content-type', 'text/plain', 'hi']));
  assert.equal(res.status, 201);
  assert.deepEqual(res.headers, [['content-type', 'text/plain']]);
  assert.equal(new TextDecoder().decode(res.body), 'hi');
  assert.throws(() => decodeResponse(encodeFields(['200', 'x-only-name', 'body'])));
});

test('request URLs keep port and query', () => {
  const url = requestUrl({
    protocol: 'http:',
    hostname: 'localhost',
    port: 4566,
    path: '/q',
    query: { a: '1', b: ['2', '3'] },
  });
  assert.equal(url, 'http://localhost:4566/q?a=1&b=2&b=3');
});
