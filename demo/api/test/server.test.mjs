// The API as a Lambda Web Function runs it: a real HTTP server on a loopback port, with the
// SDK pointed at the wasm emulator in Node. Then the built package (dist-web-function/,
// when present) is started the way Lambda starts it, to check that it listens on
// AWS_LAMBDA_HTTP_ENDPOINT and exits on SIGTERM.
// Needs EMULATOR_WASM, or the wasm in js/ (npm run wasm -w js).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { bundledWasm, loadEmulator } from 'aws-emulator-wasm/node';
import { provision } from '../provision.js';
import { createClients, createServerApp, listen } from '../server.js';

const wasm = process.env.EMULATOR_WASM ?? (existsSync(bundledWasm) ? bundledWasm : undefined);
const skip = !wasm && 'no emulator wasm: set EMULATOR_WASM or run npm run wasm -w js';

let server;
let base;

before(async () => {
  if (skip) return;
  // The shim's virtual clock skips the table's CREATING wait.
  const emulator = await loadEmulator(wasm, { wasi: 'shim' });
  const clientConfig = emulator.clientConfig({ forcePathStyle: true });
  const config = await provision(createClients(clientConfig), { seeds: [{ title: 'seeded', done: true, note: 'a note' }] });
  const app = createServerApp({ clientConfig, env: { TABLE_NAME: config.table, BUCKET_NAME: config.bucket, QUEUE_URL: config.queueUrl } });
  server = await listen(app, '127.0.0.1:0');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

async function call(method, path, body) {
  const headers = {};
  if (typeof body === 'string') headers['content-type'] = 'text/plain';
  else if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: typeof body === 'object' ? JSON.stringify(body) : body });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
}

test('the server answers the Todo API over HTTP', { skip }, async () => {
  const seeded = await call('GET', '/api/todos');
  assert.equal(seeded.status, 200);
  assert.deepEqual(seeded.body.map((t) => [t.title, t.done, t.hasNote]), [['seeded', true, true]]);
  assert.equal((await call('GET', `/api/todos/${seeded.body[0].id}/note`)).body, 'a note');

  const created = await call('POST', '/api/todos', { title: 'Buy milk' });
  assert.equal(created.status, 201);
  const { id } = created.body;
  assert.equal((await call('PATCH', `/api/todos/${id}`, { done: true })).body.done, true);
  assert.equal((await call('PUT', `/api/todos/${id}/note`, 'low fat')).body.hasNote, true);
  assert.equal((await call('DELETE', `/api/todos/${id}`)).status, 204);

  const activity = await call('GET', '/api/activity');
  assert.deepEqual(activity.body.map((e) => e.type), ['created', 'completed', 'noted', 'deleted']);
  assert.deepEqual((await call('GET', '/api/activity')).body, []);
});

test('errors are JSON with a code', { skip }, async () => {
  assert.deepEqual(await call('POST', '/api/todos', { title: ' ' }), {
    status: 400,
    body: { code: 'TITLE_REQUIRED', message: 'Enter a title' },
  });
  assert.deepEqual(await call('POST', '/api/todos', 'not json'), {
    status: 400,
    body: { code: 'BAD_JSON', message: 'The request body is not JSON' },
  });
  assert.equal((await call('PATCH', '/api/todos/missing', { done: true })).body.code, 'NOT_FOUND');
  assert.equal((await call('GET', '/api/nope')).status, 404);
});

const pkg = resolve(import.meta.dirname, '../../dist-web-function/index.js');

test('the built package listens on AWS_LAMBDA_HTTP_ENDPOINT and stops on SIGTERM', { skip: !existsSync(pkg) && 'run npm run build:web-function first' }, async () => {
  const port = await new Promise((done) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
  const child = spawn(process.execPath, [pkg], {
    env: {
      PATH: process.env.PATH,
      AWS_LAMBDA_HTTP_ENDPOINT: `127.0.0.1:${port}`,
      AWS_REGION: 'us-east-1',
      TABLE_NAME: 'todos',
      BUCKET_NAME: 'todo-notes',
      QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/000000000000/todo-activity',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const exited = new Promise((done) => child.once('exit', (code) => done(code)));
  try {
    // Lambda gives the server 10 seconds to start listening.
    const started = Date.now();
    await new Promise((done, fail) => {
      child.stdout.on('data', (chunk) => String(chunk).includes('listening on') && done());
      setTimeout(() => fail(new Error('the package did not start listening within 10 s')), 10_000);
    });
    assert.ok(Date.now() - started < 10_000);
    // A route that touches no AWS service: the package serves HTTP on the given address.
    const res = await fetch(`http://127.0.0.1:${port}/api/nope`, { headers: { 'lambda-web-request-id': 'test' } });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).code, 'NO_ROUTE');
  } finally {
    child.kill('SIGTERM');
  }
  assert.equal(await exited, 0);
});
