// How many 64 KiB pages one Todo-like change touches.
import { readFile } from 'node:fs/promises';
import { DynamoDBClient, CreateTableCommand, DescribeTableCommand, PutItemCommand, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { SQSClient, CreateQueueCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { S3Client, CreateBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { instantiateEmulator } from '../src/core.mjs';
import { createWasi } from './wasi2.mjs';
import { WasmRequestHandler } from '../src/handler.mjs';
import { nodeResponseBody } from '../src/emulator.mjs';
const module = await WebAssembly.compile(await readFile(process.argv[2]));
const wasi = createWasi({ log: () => {} });
let inst; const init = wasi.initialize; wasi.initialize = (i) => { inst = i; init(i); };
const emu = await instantiateEmulator(module, wasi);
const config = { region: 'us-east-1', endpoint: 'http://localhost:4566', credentials: { accessKeyId: 't', secretAccessKey: 't' }, requestHandler: new WasmRequestHandler(emu, { responseBody: nodeResponseBody }), maxAttempts: 1 };
const ddb = new DynamoDBClient(config), sqs = new SQSClient(config), s3 = new S3Client({ ...config, forcePathStyle: true });
await ddb.send(new CreateTableCommand({ TableName: 'todos', BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }], KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }] }));
await ddb.send(new DescribeTableCommand({ TableName: 'todos' }));
await s3.send(new CreateBucketCommand({ Bucket: 'bucket' }));
const { QueueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: 'queue' }));
const PAGE = 65536;
const snap = () => new Uint8Array(inst.exports.memory.buffer).slice();
const changed = (a, b) => { let n = 0; const len = Math.max(a.length, b.length); for (let p = 0; p < len; p += PAGE) { const x = a.subarray(p, p + PAGE), y = b.subarray(p, p + PAGE); if (x.length !== y.length) { n++; continue; } for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) { n++; break; } } return n; };
for (const [label, fn] of [
  ['PutItem + SendMessage', (i) => Promise.all([ddb.send(new PutItemCommand({ TableName: 'todos', Item: { id: { S: 'id' + i }, title: { S: 'todo ' + i } } })), sqs.send(new SendMessageCommand({ QueueUrl, MessageBody: 'x' }))])],
  ['UpdateItem', (i) => ddb.send(new UpdateItemCommand({ TableName: 'todos', Key: { id: { S: 'id' + i } }, UpdateExpression: 'SET done = :d', ExpressionAttributeValues: { ':d': { BOOL: true } } }))],
  ['PutObject 2 KB', (i) => s3.send(new PutObjectCommand({ Bucket: 'bucket', Key: 'k' + i, Body: 'n'.repeat(2048) }))],
  ['Scan (read only)', () => ddb.send(new ScanCommand({ TableName: 'todos' }))],
]) {
  const counts = [];
  for (let i = 0; i < 5; i++) { const before = snap(); await fn(i); counts.push(changed(before, snap())); }
  console.log(label, 'changed pages:', counts.join(', '), 'of', inst.exports.memory.buffer.byteLength / PAGE);
}
let t = performance.now(); const a = snap(), b = snap(); changed(a, b); console.log('compare whole memory ms', (performance.now() - t).toFixed(0));
