// Round-trips AWS SDK v3 calls through the wasm emulator.
// Needs EMULATOR_WASM=<path to aws_emulator_wasm_host.wasm>; skipped without it.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  GetItemCommand,
  ListTablesCommand,
  PutItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import {
  CreateQueueCommand,
  DeleteMessageCommand,
  GetQueueUrlCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { loadEmulator } from '../src/emulator.mjs';
import { WasmRequestHandler } from '../src/handler.mjs';

const wasm = process.env.EMULATOR_WASM;

describe('AWS SDK v3 through the wasm emulator', { skip: !wasm && 'EMULATOR_WASM is not set' }, () => {
  let ddb;
  let sqs;

  before(async () => {
    const started = performance.now();
    const emulator = await loadEmulator(wasm);
    const config = {
      region: 'us-east-1',
      endpoint: 'http://localhost:4566',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
      requestHandler: new WasmRequestHandler(emulator),
      maxAttempts: 1,
    };
    ddb = new DynamoDBClient(config);
    sqs = new SQSClient(config);
    console.log(`# load+instantiate: ${(performance.now() - started).toFixed(0)} ms`);
  });

  const timed = async (label, client, command) => {
    const started = performance.now();
    const out = await client.send(command);
    console.log(`# ${label}: ${(performance.now() - started).toFixed(1)} ms`);
    return out;
  };

  test('DynamoDB: create a table, put an item, read it back', async () => {
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
    assert.equal(created.TableDescription.TableName, 'notes');

    const described = await timed('DescribeTable', ddb, new DescribeTableCommand({ TableName: 'notes' }));
    assert.equal(described.Table.KeySchema.length, 2);

    const item = { pk: { S: 'user#1' }, sk: { S: 'note#1' }, body: { S: 'こんにちは' }, n: { N: '42' } };
    await timed('PutItem', ddb, new PutItemCommand({ TableName: 'notes', Item: item }));
    await timed('PutItem', ddb, new PutItemCommand({
      TableName: 'notes',
      Item: { ...item, sk: { S: 'note#2' } },
    }));

    const got = await timed('GetItem', ddb, new GetItemCommand({
      TableName: 'notes',
      Key: { pk: item.pk, sk: item.sk },
    }));
    assert.deepEqual(got.Item, item);

    const queried = await timed('Query', ddb, new QueryCommand({
      TableName: 'notes',
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': item.pk },
    }));
    assert.equal(queried.Count, 2);

    const tables = await timed('ListTables', ddb, new ListTablesCommand({}));
    assert.deepEqual(tables.TableNames, ['notes']);
  });

  test('SQS: create a queue, send, receive and delete a message', async () => {
    const { QueueUrl } = await timed('CreateQueue', sqs, new CreateQueueCommand({ QueueName: 'jobs' }));
    assert.match(QueueUrl, /jobs$/);

    const byName = await timed('GetQueueUrl', sqs, new GetQueueUrlCommand({ QueueName: 'jobs' }));
    assert.equal(byName.QueueUrl, QueueUrl);

    const sent = await timed('SendMessage', sqs, new SendMessageCommand({
      QueueUrl,
      MessageBody: 'hello from wasm',
    }));
    assert.ok(sent.MessageId);

    const received = await timed('ReceiveMessage', sqs, new ReceiveMessageCommand({
      QueueUrl,
      MaxNumberOfMessages: 1,
    }));
    assert.equal(received.Messages?.length, 1);
    assert.equal(received.Messages[0].Body, 'hello from wasm');
    assert.equal(received.Messages[0].MessageId, sent.MessageId);

    await timed('DeleteMessage', sqs, new DeleteMessageCommand({
      QueueUrl,
      ReceiptHandle: received.Messages[0].ReceiptHandle,
    }));
  });

  test('an unknown table is a DynamoDB error, not a crash', async () => {
    await assert.rejects(
      ddb.send(new GetItemCommand({ TableName: 'missing', Key: { pk: { S: 'x' } } })),
      (err) => err.name === 'ResourceNotFoundException',
    );
  });
});
