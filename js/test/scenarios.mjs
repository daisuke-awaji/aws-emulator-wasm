// SDK round-trip scenarios shared by the Node tests (test/sdk.test.mjs) and the browser
// page (demo/sdk.html, driven by Playwright). Each one throws on the first mismatch and
// returns the time every call took.
import {
  CreateTableCommand,
  DescribeTableCommand,
  GetItemCommand,
  ListTablesCommand,
  PutItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  CreateQueueCommand,
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';

// JSON with object keys sorted, so that key order does not matter.
const show = (v) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x,
  );

function equal(actual, expected, what) {
  if (show(actual) !== show(expected)) throw new Error(`${what}: expected ${show(expected)}, got ${show(actual)}`);
}

function ok(value, what) {
  if (!value) throw new Error(`${what}: expected a value, got ${show(value)}`);
}

async function rejects(promise, name, what) {
  try {
    await promise;
  } catch (error) {
    equal(error.name, name, what);
    return;
  }
  throw new Error(`${what}: expected ${name}, but the call succeeded`);
}

function timer(timings) {
  return async (label, client, command) => {
    const started = performance.now();
    const out = await client.send(command);
    timings.push({ label, ms: Math.round((performance.now() - started) * 10) / 10 });
    return out;
  };
}

/** @param {{ ddb: import('@aws-sdk/client-dynamodb').DynamoDBClient }} clients */
export async function dynamodb({ ddb }) {
  const timings = [];
  const timed = timer(timings);
  const created = await timed('CreateTable', ddb, new CreateTableCommand({
    TableName: 'notes',
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'pk', AttributeType: 'S' },
      { AttributeName: 'sk', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'pk', KeyType: 'HASH' },
      { AttributeName: 'sk', KeyType: 'RANGE' },
    ],
  }));
  equal(created.TableDescription.TableName, 'notes', 'CreateTable name');

  // The emulator answers DescribeTable once the table is ACTIVE (3 s after creation).
  const described = await timed('DescribeTable', ddb, new DescribeTableCommand({ TableName: 'notes' }));
  equal(described.Table.KeySchema.length, 2, 'DescribeTable key schema');
  equal(described.Table.TableStatus, 'ACTIVE', 'DescribeTable status');

  const item = { pk: { S: 'user#1' }, sk: { S: 'note#1' }, body: { S: 'こんにちは' }, n: { N: '42' } };
  await timed('PutItem', ddb, new PutItemCommand({ TableName: 'notes', Item: item }));
  await timed('PutItem', ddb, new PutItemCommand({ TableName: 'notes', Item: { ...item, sk: { S: 'note#2' } } }));

  const got = await timed('GetItem', ddb, new GetItemCommand({ TableName: 'notes', Key: { pk: item.pk, sk: item.sk } }));
  equal(got.Item, item, 'GetItem');

  const queried = await timed('Query', ddb, new QueryCommand({
    TableName: 'notes',
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': item.pk },
  }));
  equal(queried.Count, 2, 'Query count');

  const tables = await timed('ListTables', ddb, new ListTablesCommand({}));
  equal(tables.TableNames, ['notes'], 'ListTables');

  await rejects(
    ddb.send(new GetItemCommand({ TableName: 'missing', Key: { pk: { S: 'x' } } })),
    'ResourceNotFoundException',
    'GetItem on a missing table',
  );
  return timings;
}

/** @param {{ s3: import('@aws-sdk/client-s3').S3Client }} clients  (forcePathStyle: true) */
export async function s3({ s3 }) {
  const timings = [];
  const timed = timer(timings);
  await timed('CreateBucket', s3, new CreateBucketCommand({ Bucket: 'attachments' }));
  await timed('PutObject', s3, new PutObjectCommand({
    Bucket: 'attachments',
    Key: 'notes/1.txt',
    Body: 'こんにちは、S3',
    ContentType: 'text/plain; charset=utf-8',
  }));
  const got = await timed('GetObject', s3, new GetObjectCommand({ Bucket: 'attachments', Key: 'notes/1.txt' }));
  equal(await got.Body.transformToString(), 'こんにちは、S3', 'GetObject body');
  equal(got.ContentType, 'text/plain; charset=utf-8', 'GetObject content type');

  const listed = await timed('ListObjectsV2', s3, new ListObjectsV2Command({ Bucket: 'attachments' }));
  equal(listed.Contents?.map((c) => c.Key), ['notes/1.txt'], 'ListObjectsV2 keys');

  await timed('DeleteObject', s3, new DeleteObjectCommand({ Bucket: 'attachments', Key: 'notes/1.txt' }));
  const after = await s3.send(new ListObjectsV2Command({ Bucket: 'attachments' }));
  equal(after.KeyCount, 0, 'ListObjectsV2 after delete');

  await rejects(
    s3.send(new GetObjectCommand({ Bucket: 'attachments', Key: 'notes/1.txt' })),
    'NoSuchKey',
    'GetObject on a deleted key',
  );
  return timings;
}

/** @param {{ sqs: import('@aws-sdk/client-sqs').SQSClient }} clients */
export async function sqs({ sqs }) {
  const timings = [];
  const timed = timer(timings);
  const { QueueUrl } = await timed('CreateQueue', sqs, new CreateQueueCommand({ QueueName: 'jobs' }));
  ok(QueueUrl?.endsWith('/jobs'), 'CreateQueue url');

  const byName = await timed('GetQueueUrl', sqs, new GetQueueUrlCommand({ QueueName: 'jobs' }));
  equal(byName.QueueUrl, QueueUrl, 'GetQueueUrl');

  const sent = await timed('SendMessage', sqs, new SendMessageCommand({ QueueUrl, MessageBody: 'hello from wasm' }));
  ok(sent.MessageId, 'SendMessage id');

  const received = await timed('ReceiveMessage', sqs, new ReceiveMessageCommand({ QueueUrl, MaxNumberOfMessages: 1 }));
  equal(received.Messages?.length, 1, 'ReceiveMessage count');
  equal(received.Messages[0].Body, 'hello from wasm', 'ReceiveMessage body');
  equal(received.Messages[0].MessageId, sent.MessageId, 'ReceiveMessage id');

  await timed('DeleteMessage', sqs, new DeleteMessageCommand({ QueueUrl, ReceiptHandle: received.Messages[0].ReceiptHandle }));
  return timings;
}

export const scenarios = { dynamodb, s3, sqs };
