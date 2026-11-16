// The API as a Lambda Web Function runs it: a real HTTP server on a loopback port, with the
// SDK pointed at the wasm emulator in Node and a stand-in for the Cognito verifier. Then
// the built package (dist-web-function/, when present) is started the way Lambda starts
// it, to check that it listens on AWS_LAMBDA_HTTP_ENDPOINT, turns away a caller without a
// token, and exits on SIGTERM.
// Needs EMULATOR_WASM, or the wasm in js/ (npm run wasm -w js).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { JwtInvalidSignatureError } from 'aws-jwt-verify/error';
import { bundledWasm, loadEmulator } from 'aws-emulator-wasm/node';
import { provision } from '../provision.js';
import { bearerAuth, createClients, createServerApp, listen } from '../server.js';

const ORIGIN = 'https://app.example';
// Stand-in for CognitoJwtVerifier: two known tokens, everything else fails verification.
const verifier = {
  async verify(token) {
    const sub = { 'token-alice': 'alice', 'token-bob': 'bob' }[token];
    // What aws-jwt-verify throws for a token that is not from the pool.
    if (!sub) throw new JwtInvalidSignatureError('invalid signature');
    return { sub };
  },
};

const wasm = process.env.EMULATOR_WASM ?? (existsSync(bundledWasm) ? bundledWasm : undefined);
const skip = !wasm && 'no emulator wasm: set EMULATOR_WASM or run npm run wasm -w js';

let server;
let base;

before(async () => {
  if (skip) return;
  // The shim's virtual clock skips the table's CREATING wait.
  const emulator = await loadEmulator(wasm, { wasi: 'shim' });
  const clientConfig = emulator.clientConfig({ forcePathStyle: true });
  const config = await provision(createClients(clientConfig), { user: 'alice', seeds: [{ title: 'seeded', done: true, note: 'a note' }] });
  const env = { TABLE_NAME: config.table, BUCKET_NAME: config.bucket, QUEUE_URL: config.queueUrl, ALLOWED_ORIGINS: ORIGIN };
  const app = createServerApp({ clientConfig, env, verifier });
  server = await listen(app, '127.0.0.1:0');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

async function call(method, path, body, token = 'token-alice') {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
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
  assert.deepEqual(await call('GET', '/api/nope'), { status: 404, body: { code: 'NO_ROUTE', message: 'No route for GET /api/nope' } });
});

test('a verifier that cannot check (JWKS unreachable) is a 500, not a 401', { skip }, async () => {
  const { FetchError, JwtExpiredError } = await import('aws-jwt-verify/error');
  const auth = bearerAuth({
    async verify(token) {
      if (token === 'expired') throw new JwtExpiredError('expired', 0);
      throw new FetchError('https://cognito-idp.example/jwks.json', 'timeout');
    },
  });
  const c = (token) => ({ req: { header: () => `Bearer ${token}` } });
  await assert.rejects(auth(c('expired')), (e) => e.status === 401);
  await assert.rejects(auth(c('any')), (e) => e instanceof FetchError);
});

test('without a valid token every route is a 401 that names the Bearer scheme', { skip }, async () => {
  for (const token of [null, 'forged']) {
    for (const [method, path] of [['GET', '/api/todos'], ['POST', '/api/todos'], ['GET', '/api/activity'], ['GET', '/api/nope']]) {
      const res = await fetch(base + path, { method, headers: token ? { authorization: `Bearer ${token}` } : {} });
      assert.equal(res.status, 401, `${method} ${path} with ${token}`);
      assert.equal(res.headers.get('www-authenticate'), 'Bearer');
      assert.equal((await res.json()).code, 'UNAUTHORIZED');
    }
  }
  const basic = await fetch(`${base}/api/todos`, { headers: { authorization: 'Basic dG9rZW4tYWxpY2U=' } });
  assert.equal(basic.status, 401);
});

test('each user sees only their own todos, notes and events', { skip }, async () => {
  const mine = await call('POST', '/api/todos', { title: 'alice only' });
  assert.equal(mine.status, 201);
  assert.deepEqual((await call('GET', '/api/todos', undefined, 'token-bob')).body, []);
  assert.equal((await call('PATCH', `/api/todos/${mine.body.id}`, { done: true }, 'token-bob')).status, 404);
  assert.equal((await call('DELETE', `/api/todos/${mine.body.id}`, undefined, 'token-bob')).status, 404);
  assert.equal((await call('PUT', `/api/todos/${mine.body.id}/note`, 'x', 'token-bob')).status, 404);
  assert.equal((await call('GET', `/api/todos/${mine.body.id}/note`, undefined, 'token-bob')).body, '');
  // Bob's drain leaves Alice's event in the queue.
  assert.deepEqual((await call('GET', '/api/activity', undefined, 'token-bob')).body, []);
  assert.deepEqual((await call('GET', '/api/activity')).body.map((e) => [e.type, e.title]), [['created', 'alice only']]);
  assert.equal((await call('DELETE', `/api/todos/${mine.body.id}`)).status, 204);
  await call('GET', '/api/activity');
});

test("another user's backlog on the shared queue does not hide this user's events", { skip }, async () => {
  // More than one receive (10 messages) of Bob's events, waiting in the queue.
  const bobs = [];
  for (let i = 0; i < 15; i++) bobs.push((await call('POST', '/api/todos', { title: `bob ${i}` }, 'token-bob')).body.id);
  const mine = await call('POST', '/api/todos', { title: 'alice after the backlog' });
  assert.deepEqual((await call('GET', '/api/activity')).body.map((e) => e.title), ['alice after the backlog']);
  // Bob's events were released, not lost.
  assert.equal((await call('GET', '/api/activity', undefined, 'token-bob')).body.length, 15);
  await call('DELETE', `/api/todos/${mine.body.id}`);
  for (const id of bobs) await call('DELETE', `/api/todos/${id}`, undefined, 'token-bob');
  await call('GET', '/api/activity');
  await call('GET', '/api/activity', undefined, 'token-bob');
});

test('CORS admits the configured origin only', { skip }, async () => {
  const preflight = (origin) =>
    fetch(`${base}/api/todos`, {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' },
    });
  const ok = await preflight(ORIGIN);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(ok.headers.get('access-control-allow-headers'), /authorization/);
  const other = await preflight('https://evil.example');
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  // Errors carry the header too, so the page can read a 401.
  const denied = await fetch(`${base}/api/todos`, { headers: { origin: ORIGIN } });
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get('access-control-allow-origin'), ORIGIN);
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
      COGNITO_USER_POOL_ID: 'us-east-1_example',
      COGNITO_CLIENT_ID: 'exampleclientid',
      ALLOWED_ORIGINS: ORIGIN,
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
    // An anonymous caller is turned away before any AWS call.
    const res = await fetch(`http://127.0.0.1:${port}/api/todos`, { headers: { 'lambda-web-request-id': 'test' } });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('www-authenticate'), 'Bearer');
  } finally {
    child.kill('SIGTERM');
  }
  assert.equal(await exited, 0);
});
