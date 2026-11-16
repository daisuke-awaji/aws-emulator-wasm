// Two processes stand for two page loads: "save" works and writes the memory, "load" restores it.
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { DynamoDBClient, CreateTableCommand, DescribeTableCommand, PutItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { SQSClient, CreateQueueCommand, SendMessageCommand, ReceiveMessageCommand, GetQueueUrlCommand } from '@aws-sdk/client-sqs';
import { instantiateEmulator } from '../src/core.mjs';
import { createWasi } from './wasi2.mjs';
import { WasmRequestHandler } from '../src/handler.mjs';
import { nodeResponseBody } from '../src/emulator.mjs';
const [mode, wasmPath] = process.argv.slice(2);
const module = await WebAssembly.compile(await readFile(wasmPath));
const meta = mode === 'load' ? JSON.parse(await readFile('/tmp/snap.json', 'utf8')) : null;
const wasi = createWasi({ log: () => {}, skippedNs: meta ? BigInt(meta.skippedNs) : 0n });
let inst; const init = wasi.initialize; wasi.initialize = (i) => { inst = i; init(i); };
const emu = await instantiateEmulator(module, wasi);
const config = { region: 'us-east-1', endpoint: 'http://localhost:4566', credentials: { accessKeyId: 't', secretAccessKey: 't' }, requestHandler: new WasmRequestHandler(emu, { responseBody: nodeResponseBody }), maxAttempts: 1 };
const ddb = new DynamoDBClient(config), sqs = new SQSClient(config);
if (mode === 'save') {
  await ddb.send(new CreateTableCommand({ TableName: 'todos', BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }], KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }] }));
  await ddb.send(new DescribeTableCommand({ TableName: 'todos' }));
  await ddb.send(new PutItemCommand({ TableName: 'todos', Item: { id: { S: 'a' }, title: { S: 'saved before reload' } } }));
  const { QueueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: 'queue', Attributes: { VisibilityTimeout: '5' } }));
  await sqs.send(new SendMessageCommand({ QueueUrl, MessageBody: 'm1' }));
  const got = await sqs.send(new ReceiveMessageCommand({ QueueUrl })); // in flight for 5 s
  const mem = new Uint8Array(inst.exports.memory.buffer);
  await writeFile('/tmp/snap.gz', gzipSync(mem, { level: 1 }));
  await writeFile('/tmp/snap.json', JSON.stringify({ skippedNs: String(wasi.skippedNs), bytes: mem.length }));
  console.log('saved', mem.length, 'received', got.Messages?.length);
} else {
  const snap = gunzipSync(await readFile('/tmp/snap.gz'));
  const m = inst.exports.memory; if (snap.length > m.buffer.byteLength) m.grow((snap.length - m.buffer.byteLength) / 65536);
  new Uint8Array(m.buffer).set(snap);
  const scan = await ddb.send(new ScanCommand({ TableName: 'todos' }));
  console.log('scan', scan.Items.map((i) => i.title.S));
  const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: 'queue' }));
  console.log('right away (still in flight):', (await sqs.send(new ReceiveMessageCommand({ QueueUrl }))).Messages?.length ?? 0);
  await new Promise((r) => setTimeout(r, 5500));
  console.log('after the visibility timeout:', (await sqs.send(new ReceiveMessageCommand({ QueueUrl }))).Messages?.map((x) => x.Body));
  await ddb.send(new PutItemCommand({ TableName: 'todos', Item: { id: { S: 'b' }, title: { S: 'after reload' } } }));
  console.log('scan', (await ddb.send(new ScanCommand({ TableName: 'todos' }))).Count);
}
