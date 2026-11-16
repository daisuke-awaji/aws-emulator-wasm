// A snapshot of the wasm memory, restored into a new instance, keeps every service's state.
// Needs EMULATOR_WASM=<path to the .wasm>; skipped without it.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { CreateTableCommand, DescribeTableCommand, DynamoDBClient, PutItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { CreateBucketCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { CreateQueueCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { instantiateEmulator } from '../src/core.mjs';
import { nodeResponseBody } from '../src/emulator.mjs';
import { WasmRequestHandler } from '../src/handler.mjs';
import { createWasi } from '../src/wasi.mjs';

const wasm = process.env.EMULATOR_WASM;

async function boot(module, resume) {
  const wasi = createWasi({ log: () => {}, resume });
  const emulator = await instantiateEmulator(module, wasi);
  const config = {
    region: 'us-east-1',
    endpoint: 'http://localhost:4566',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    requestHandler: new WasmRequestHandler(emulator, { responseBody: nodeResponseBody }),
    maxAttempts: 1,
  };
  return {
    wasi,
    emulator,
    ddb: new DynamoDBClient(config),
    s3: new S3Client({ ...config, forcePathStyle: true }),
    sqs: new SQSClient(config),
  };
}

test('a restored snapshot keeps DynamoDB, S3 and SQS', { skip: !wasm && 'EMULATOR_WASM is not set' }, async () => {
  const module = await WebAssembly.compile(await readFile(wasm));
  const a = await boot(module);
  await a.ddb.send(new CreateTableCommand({
    TableName: 'todos',
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
  }));
  await a.ddb.send(new DescribeTableCommand({ TableName: 'todos' })); // waits out CREATING on the virtual clock
  await a.ddb.send(new PutItemCommand({ TableName: 'todos', Item: { id: { S: '1' }, title: { S: '牛乳を買う' } } }));
  await a.s3.send(new CreateBucketCommand({ Bucket: 'notes' }));
  await a.s3.send(new PutObjectCommand({ Bucket: 'notes', Key: 'n.txt', Body: 'メモ' }));
  const { QueueUrl } = await a.sqs.send(new CreateQueueCommand({ QueueName: 'activity' }));
  await a.sqs.send(new SendMessageCommand({ QueueUrl, MessageBody: 'created' }));

  const memory = a.emulator.snapshot();
  const clock = a.wasi.clockState;
  assert.ok(clock.skippedNs > 0n);

  const b = await boot(module, clock);
  b.emulator.restore(memory);
  const scan = await b.ddb.send(new ScanCommand({ TableName: 'todos' }));
  assert.deepEqual(scan.Items.map((i) => i.title.S), ['牛乳を買う']);
  const note = await b.s3.send(new GetObjectCommand({ Bucket: 'notes', Key: 'n.txt' }));
  assert.equal(await note.Body.transformToString(), 'メモ');
  const got = await b.sqs.send(new ReceiveMessageCommand({ QueueUrl }));
  assert.deepEqual(got.Messages.map((m) => m.Body), ['created']);
  // The restored instance keeps working.
  for (let i = 2; i <= 50; i++) {
    await b.ddb.send(new PutItemCommand({ TableName: 'todos', Item: { id: { S: String(i) }, title: { S: `todo ${i}` } } }));
  }
  assert.equal((await b.ddb.send(new ScanCommand({ TableName: 'todos' }))).Count, 50);
});

test('restore refuses memory that does not fit', { skip: !wasm && 'EMULATOR_WASM is not set' }, async () => {
  const module = await WebAssembly.compile(await readFile(wasm));
  const { emulator } = await boot(module);
  assert.throws(() => emulator.restore(new Uint8Array(65536 + 1)), /whole number of pages/);
  assert.throws(() => emulator.restore(new Uint8Array(65536)), /smaller than the fresh memory/);
});
