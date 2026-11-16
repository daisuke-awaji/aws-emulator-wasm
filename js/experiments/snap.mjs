// Experiment for docs/persistence-design.md: snapshot the whole wasm memory, restore it into a new instance.
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { DynamoDBClient, CreateTableCommand, DescribeTableCommand, PutItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, CreateBucketCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, CreateQueueCommand, SendMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { instantiateEmulator } from '../src/core.mjs';
import { createWasi } from './wasi2.mjs';
import { WasmRequestHandler } from '../src/handler.mjs';
import { nodeResponseBody } from '../src/emulator.mjs';

const module = await WebAssembly.compile(await readFile(process.argv[2]));
const globals = WebAssembly.Module.exports(module).filter((e) => e.kind !== 'function');
console.log('non-function exports:', globals);

async function boot(skippedNs) {
  const wasi = createWasi({ log: () => {}, skippedNs });
  let inst;
  const orig = wasi.initialize;
  wasi.initialize = (i) => { inst = i; orig(i); };
  const emu = await instantiateEmulator(module, wasi);
  const config = { region: 'us-east-1', endpoint: 'http://localhost:4566', credentials: { accessKeyId: 't', secretAccessKey: 't' },
    requestHandler: new WasmRequestHandler(emu, { responseBody: nodeResponseBody }), maxAttempts: 1 };
  return { inst, emu, wasi, ddb: new DynamoDBClient(config), s3: new S3Client({ ...config, forcePathStyle: true }), sqs: new SQSClient(config) };
}

const a = await boot();
await a.ddb.send(new CreateTableCommand({ TableName: 'todos', BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }], KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }] }));
await a.ddb.send(new DescribeTableCommand({ TableName: 'todos' }));
for (let i = 0; i < 3; i++) await a.ddb.send(new PutItemCommand({ TableName: 'todos', Item: { id: { S: `id${i}` }, title: { S: `todo ${i}` } } }));
await a.s3.send(new CreateBucketCommand({ Bucket: 'bucket' }));
await a.s3.send(new PutObjectCommand({ Bucket: 'bucket', Key: 'k', Body: 'hello note' }));
const { QueueUrl } = await a.sqs.send(new CreateQueueCommand({ QueueName: 'queue' }));
await a.sqs.send(new SendMessageCommand({ QueueUrl, MessageBody: 'm1' }));

let t = performance.now();
const snap = new Uint8Array(a.inst.exports.memory.buffer).slice();
const copyMs = performance.now() - t;
const PAGE = 65536; let nonzero = 0;
for (let p = 0; p < snap.length; p += PAGE) { const v = snap.subarray(p, p + PAGE); if (v.some((x) => x !== 0)) nonzero++; }
t = performance.now(); const gz = gzipSync(snap, { level: 1 }); const gzMs = performance.now() - t;
console.log({ memoryMiB: (snap.length / 2 ** 20).toFixed(1), pages: snap.length / PAGE, nonzeroPages: nonzero, gzipMiB: (gz.length / 2 ** 20).toFixed(2), copyMs: copyMs.toFixed(1), gzMs: gzMs.toFixed(0), skippedMs: a.wasi.skippedMs });

// Restore into a brand-new instance.
const b = await boot(a.wasi.skippedNs);
const mem = b.inst.exports.memory;
const fresh = mem.buffer.byteLength;
if (snap.length > fresh) mem.grow((snap.length - fresh) / PAGE);
t = performance.now();
new Uint8Array(mem.buffer).set(snap);
console.log('restore set ms', (performance.now() - t).toFixed(1), 'fresh MiB', (fresh / 2 ** 20).toFixed(1));
const scan = await b.ddb.send(new ScanCommand({ TableName: 'todos' }));
console.log('scan', scan.Count, scan.Items.map((i) => i.title.S));
const obj = await b.s3.send(new GetObjectCommand({ Bucket: 'bucket', Key: 'k' }));
console.log('s3', await obj.Body.transformToString());
const rec = await b.sqs.send(new ReceiveMessageCommand({ QueueUrl, MaxNumberOfMessages: 10 }));
console.log('sqs', rec.Messages?.map((m) => m.Body));
for (let i = 3; i < 200; i++) await b.ddb.send(new PutItemCommand({ TableName: 'todos', Item: { id: { S: `id${i}` }, title: { S: `todo ${i}`.repeat(20) } } }));
await b.ddb.send(new CreateTableCommand({ TableName: 'todos2', BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }], KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }] }));
await b.ddb.send(new DescribeTableCommand({ TableName: 'todos2' }));
console.log('after restore: scan', (await b.ddb.send(new ScanCommand({ TableName: 'todos' }))).Count, 'memory MiB', (mem.buffer.byteLength / 2 ** 20).toFixed(1));
