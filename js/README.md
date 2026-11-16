# aws-emulator-wasm: user guide

[AWS Emulator](https://github.com/aws/aws-emulator) compiled to WebAssembly, packaged for AWS SDK for JavaScript v3. It gives you DynamoDB, S3 and SQS inside a browser tab (in a Web Worker) or a Node process, with no server, no Docker and no AWS account.

Typical uses:

- A static mock or prototype (GitHub Pages, Vercel, an artifact from a coding agent) whose "backend" is SDK code running against the emulator, usually behind [MSW](https://mswjs.io/).
- Tests and demos of SDK code that should not touch a real account.

The [Todo demo](https://daisuke-awaji.github.io/aws-emulator-wasm/) is built this way; its source is in [`demo/`](../demo).

## Install

The package is not on the npm registry. Each release on GitHub has the package as a tarball, with the wasm inside:

```bash
npm install https://github.com/daisuke-awaji/aws-emulator-wasm/releases/download/v0.1.0/aws-emulator-wasm-0.1.0.tgz
```

`package.json` then records the URL, and the lockfile its checksum:

```json
"dependencies": {
  "aws-emulator-wasm": "https://github.com/daisuke-awaji/aws-emulator-wasm/releases/download/v0.1.0/aws-emulator-wasm-0.1.0.tgz"
}
```

Install the SDK clients you use yourself (any v3 version):

```bash
npm install @aws-sdk/client-dynamodb @aws-sdk/client-s3 @aws-sdk/client-sqs
```

> [!NOTE]
> `npm install github:daisuke-awaji/aws-emulator-wasm` does not work: the package lives in `js/` of the repository, and the wasm is built by CI rather than committed. Use the release tarball. The list of releases is at [Releases](https://github.com/daisuke-awaji/aws-emulator-wasm/releases).

Requirements: Node 22 or later. Browsers need module Workers and WebAssembly (current Chrome, Edge, Firefox and Safari). Persistence also needs OPFS and a secure context (`https://` or `localhost`).

## Browser

```js
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { createEmulator } from 'aws-emulator-wasm/browser';
import wasmUrl from 'aws-emulator-wasm/aws-emulator.wasm?url'; // Vite

const emulator = createEmulator({ wasmUrl });

const ddb = new DynamoDBClient(emulator.clientConfig());
const s3 = new S3Client(emulator.clientConfig({ forcePathStyle: true }));
const sqs = new SQSClient(emulator.clientConfig());

await ddb.send(new ListTablesCommand({}));
```

`createEmulator` starts a Web Worker and downloads the wasm (about 27 MB, or 9 MB with gzip). SDK calls made before it is ready wait for it. `await emulator.ready` if you want to show a loading state.

`clientConfig()` returns ordinary client settings: region `us-east-1`, dummy credentials, a local endpoint, and a request handler that posts each signed request to the Worker instead of the network. Pass overrides as the argument. S3 needs `forcePathStyle: true`.

### Getting the wasm URL

`wasmUrl` is any URL the page can fetch the file from.

| Setup | How |
|---|---|
| Vite | `import wasmUrl from 'aws-emulator-wasm/aws-emulator.wasm?url'`. The file is served in dev and copied into the build with a content hash. |
| webpack 5, Rspack, Parcel | `new URL('aws-emulator-wasm/aws-emulator.wasm', import.meta.url)` |
| No bundler, or a CDN | Copy `node_modules/aws-emulator-wasm/aws-emulator.wasm` into your static files and pass its path, e.g. `'/aws-emulator.wasm'`. |

Serve it as `application/wasm` (GitHub Pages, Vercel and Vite do) to compile it while it downloads.

The Worker script is found with `new URL('./worker.mjs', import.meta.url)`, which Vite and webpack follow. If your bundler does not, create the Worker yourself and pass it:

```js
const worker = new Worker(new URL('aws-emulator-wasm/browser/worker', import.meta.url), { type: 'module' });
const emulator = createEmulator({ wasmUrl, worker });
```

### Behind MSW

To give a front end a REST API with no server, let MSW catch the requests and write the handlers with the SDK, as a Lambda function would:

```bash
npm install msw @aws-sdk/lib-dynamodb
npx msw init public   # puts mockServiceWorker.js in your static files
```

```js
// mocks.js
import { setupWorker } from 'msw/browser';
import { http, HttpResponse } from 'msw';
import { CreateTableCommand, DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { createEmulator } from 'aws-emulator-wasm/browser';
import wasmUrl from 'aws-emulator-wasm/aws-emulator.wasm?url';

const emulator = createEmulator({ wasmUrl });
const ddb = new DynamoDBClient(emulator.clientConfig());
const docs = DynamoDBDocumentClient.from(ddb);

// Create the table once, before the first request is handled.
const setup = (async () => {
  await ddb.send(new CreateTableCommand({
    TableName: 'todos',
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
  }));
  // The new table is CREATING; DescribeTable answers once it is ACTIVE (the virtual clock skips the wait).
  await ddb.send(new DescribeTableCommand({ TableName: 'todos' }));
})();

export const worker = setupWorker(
  http.get('/api/todos', async () => {
    await setup;
    const { Items } = await docs.send(new ScanCommand({ TableName: 'todos' }));
    return HttpResponse.json(Items);
  }),
  http.post('/api/todos', async ({ request }) => {
    await setup;
    const item = { id: crypto.randomUUID(), ...(await request.json()) };
    await docs.send(new PutCommand({ TableName: 'todos', Item: item }));
    return HttpResponse.json(item, { status: 201 });
  }),
);
```

```js
// main.js
import { worker } from './mocks.js';
await worker.start({ onUnhandledRequest: 'bypass' });
// render the app; its fetch('/api/todos') calls now reach the emulator
```

The SDK calls go from the handlers straight to the emulator's Worker, not through `fetch`, so MSW does not see them.

#### Keeping the API portable to Lambda

Write the API as a [Hono](https://hono.dev/) app (or anything with a `fetch(Request) → Response` entry) that takes its SDK clients as arguments, and let MSW hand it whole requests. In production, run the same app as an HTTP server, which is what [Lambda Web Functions](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html) run: no Lambda adapter and no API Gateway.

```js
// browser
http.all('/api/*', ({ request }) => app.fetch(request));

// Lambda Web Function (index.js at the package root)
const [hostname, port] = (process.env.AWS_LAMBDA_HTTP_ENDPOINT || 'localhost:3000').split(':');
serve({ fetch: createApp(clientsFromEnvironment).fetch, hostname, port: Number(port) }); // @hono/node-server
```

The demo does exactly this. [`demo/api/`](../demo/api) is the app and the server, and its [README](../demo/api/README.md) covers the package, resources, permissions and differences in production.

### Keep state across reloads

By default the emulator starts empty on every page load. With `persist`, the Worker saves a snapshot of the wasm memory to OPFS when requests pause, and restores it before `ready` resolves:

```js
const emulator = createEmulator({
  wasmUrl,
  persist: { name: 'my-app' },
  onLock: (state) => console.log(state), // 'waiting' | 'held' | 'lost'
});

const { persistence } = await emulator.ready;
// { enabled: true, restored: true, savedAt: '2026-11-16T11:26:06.000Z' }
if (!persistence.restored) {
  // first visit, or the saved state could not be used: create tables and seed data here
}
```

| Event | What happens |
|---|---|
| Requests pause for 100 ms | The Worker copies the wasm memory (a few ms) and writes a gzip snapshot to OPFS in the background (about 2.5 MB and 250 ms). |
| Page loads | The snapshot is written back before `ready` resolves: tables, objects, queues and in-flight message visibility all carry on. |
| A new wasm build is deployed | The snapshot belongs to another build, so it is dropped and the emulator starts empty (`discarded: 'version'`). |
| The tab closes mid-write | Snapshots alternate between two slots, so the previous one is still there (`discarded: 'corrupt'`). |
| A second tab opens | It waits (`onLock('waiting')`). `takeOver()` moves the emulator to it, and the first tab stops (`'lost'`). |

`flush()` resolves once everything answered so far is saved. `reset()` stops the emulator and deletes the saved state; reload the page to start again.

> [!WARNING]
> A tab closed before the last save finishes loses that last action. Browsers may also evict site data under storage pressure, and Safari deletes it after 7 days without use. Do not keep anything there you cannot lose.

## Node

```js
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { loadEmulator } from 'aws-emulator-wasm/node';

const emulator = await loadEmulator(); // the wasm in the package
const ddb = new DynamoDBClient(emulator.clientConfig());

console.log(await ddb.send(new ListTablesCommand({})));
```

Node runs the wasm in the same process, with `node:wasi` (it prints an ExperimentalWarning). `loadEmulator(path, { wasi: 'shim', clock: 'virtual' })` uses the browser's WASI code instead, whose virtual clock skips waits such as a new DynamoDB table being `CREATING`. Each `loadEmulator()` is an independent, empty emulator, which suits one per test file.

## API

### `aws-emulator-wasm/browser`

| Name | Description |
|---|---|
| `createEmulator(options)` | Starts the Worker and returns the emulator. |
| `options.wasmUrl` | Required. URL of `aws-emulator.wasm`. |
| `options.worker` | A Worker you created from `aws-emulator-wasm/browser/worker`. |
| `options.clock` | `'virtual'` (default: waits inside the emulator are skipped) or `'real'`. |
| `options.persist` | `false` (default) or `{ name, takeOver? }`. `takeOver: true` starts at once and stops the other tab. |
| `options.onCall(call)` | `{ seq, method, url, headers, status, ms, startedAt }` for every answered request. |
| `options.onLock(state)` | With `persist`: `'waiting'`, `'held'` or `'lost'`. |
| `options.onSave(event)` | With `persist`: `{ at, ms, bytes, requests }` after a save, or `{ error }`. |
| `options.onLog(stream, line)` | The emulator's stdout and stderr. |
| `emulator.ready` | Resolves with `stats` once the wasm is instantiated (and restored); rejects if it fails to start. |
| `emulator.clientConfig(overrides?)` | SDK client settings that send every call to this emulator. |
| `emulator.requestHandler` | The SDK request handler alone, for your own client settings. |
| `emulator.fetch(request)` | The same transport without the SDK: `{ method, url, headers: [name, value][], body: Uint8Array }`. |
| `emulator.stats` | `{ requests, skippedMs, fetchCompileMs, instantiateMs, persistence }`. |
| `emulator.lock` | The current lock state, with `persist`. |
| `emulator.takeOver()` | While `'waiting'`: take the emulator from the other tab. |
| `emulator.flush()` | Resolves when everything answered so far is saved. |
| `emulator.reset()` | Stops the emulator and deletes the saved state. |
| `emulator.terminate()` | Stops the Worker. |

### `aws-emulator-wasm/node`

| Name | Description |
|---|---|
| `loadEmulator(wasmPath?, options?)` | Compiles and starts the wasm. `wasmPath` defaults to the wasm in the package. |
| `options.wasi` | `'node'` (default, `node:wasi`) or `'shim'` (the browser's WASI code). |
| `options.clock` | With `wasi: 'shim'`: `'virtual'` (default) or `'real'`. |
| `emulator.clientConfig(overrides?)`, `emulator.requestHandler`, `emulator.fetch(request)` | As in the browser. |
| `emulator.snapshot()` / `emulator.restore(bytes)` | Copy the wasm memory out, and write it into a fresh instance of the same build (see the clock note in [`src/core.mjs`](./src/core.mjs)). |

Other entry points (`/handler`, `/wasi`, `/codec`, `/snapshot-format`, `/scenarios`) are the building blocks the two loaders use.

## What to expect

- **Services.** DynamoDB, S3 and SQS. The build contains 13 services in all, as those three depend on others, but only these three are tested.
- **Behaviour.** Requests are answered by AWS Emulator's own service code, so validation and errors follow it (for example, a table name shorter than 3 characters is rejected). Anything AWS Emulator does not implement is not here either.
- **State.** Everything is in memory, in one tab or one process. Nothing is shared between users.
- **Not for production.** It is a mock: no authentication (any credentials work), no durability beyond the snapshot above.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ready` rejects: `wasm` fetch is 404 | Check `wasmUrl`. Under a sub-path (e.g. GitHub Pages `/<repo>/`), a hard-coded `'/aws-emulator.wasm'` points at the wrong place; use the bundler import. |
| The Worker script is 404 in Vite dev | Add `optimizeDeps: { exclude: ['aws-emulator-wasm'] }` to `vite.config.js`, or pass your own `worker`. |
| S3 calls go to `my-bucket.localhost` | Use `clientConfig({ forcePathStyle: true })` for S3. |
| Data is gone after a reload | Pass `persist: { name }`. Without OPFS (some private windows, or a page not on `https://` or `localhost`), `persistence.enabled` is `false`. |
| The second tab never loads | It is `'waiting'` for the first tab (with `persist`). Close the first tab, or call `takeOver()`. |
