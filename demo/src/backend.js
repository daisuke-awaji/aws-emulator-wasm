// The Todo "backend": what a Lambda behind API Gateway might do, written against the AWS
// SDK. Todos live in DynamoDB, notes in S3, and every change is published to SQS.
import { ConditionalCheckFailedException, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand } from '@aws-sdk/client-s3';
import { CreateQueueCommand, DeleteMessageBatchCommand, GetQueueUrlCommand, ReceiveMessageCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DeleteCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { inSetup } from './calls.js';
import { ddb, docs, emulator, s3, sqs } from './emulator.js';

export const TABLE = 'todos';
export const BUCKET = 'todo-notes';
export const QUEUE = 'todo-activity';
export const MAX_TITLE = 200;
export const MAX_NOTE = 10_000;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let queueUrl;

async function setup() {
  const { persistence } = await emulator.ready;
  if (persistence?.restored) {
    // The table, bucket, queue and Todos came back with the emulator's saved memory.
    ({ QueueUrl: queueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: QUEUE })));
    return;
  }
  await ddb.send(new CreateTableCommand({
    TableName: TABLE,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
  }));
  // The table is CREATING at first; DescribeTable answers once it is ACTIVE.
  await ddb.send(new DescribeTableCommand({ TableName: TABLE }));
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  ({ QueueUrl: queueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: QUEUE })));

  const seeds = [
    { title: 'AWS Emulator を wasm にビルドする', done: true, note: 'wasm32-wasip1 向けにビルドする。' },
    { title: 'ブラウザの Worker で動かす', done: true },
    { title: 'MSW のハンドラから DynamoDB・S3・SQS を呼ぶ', done: false },
  ];
  for (const [i, seed] of seeds.entries()) {
    const todo = await create({ title: seed.title }, new Date(Date.UTC(2026, 10, 16, 0, 0, i)).toISOString(), false);
    if (seed.done) await update(todo.id, { done: true }, false);
    if (seed.note) await putNote(todo.id, seed.note, false);
  }
}

let ready;
/**
 * Once per page: creates the table, bucket, queue and seed Todos, or, when the emulator
 * restored its saved state, just looks the queue up again.
 */
export const ensureSetup = () => (ready ??= inSetup(setup));

async function publish(type, todo) {
  await sqs.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify({ type, id: todo.id, title: todo.title, at: new Date().toISOString() }),
  }));
}

function checkTitle(title) {
  if (typeof title !== 'string' || title.trim() === '') throw new HttpError(400, 'タイトルを入力してください');
  if ([...title.trim()].length > MAX_TITLE) throw new HttpError(400, `タイトルは ${MAX_TITLE} 文字以内にしてください`);
  return title.trim();
}

export async function list() {
  const items = [];
  let ExclusiveStartKey;
  do {
    const page = await docs.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey }));
    items.push(...page.Items);
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

export async function create(input, createdAt = new Date().toISOString(), notify = true) {
  const todo = { id: crypto.randomUUID(), title: checkTitle(input?.title), done: false, hasNote: false, createdAt };
  await docs.send(new PutCommand({ TableName: TABLE, Item: todo }));
  if (notify) await publish('created', todo);
  return todo;
}

export async function update(id, patch, notify = true) {
  const sets = [];
  const values = {};
  if (patch?.title !== undefined) {
    values[':title'] = checkTitle(patch.title);
    sets.push('title = :title');
  }
  if (patch?.done !== undefined) {
    if (typeof patch.done !== 'boolean') throw new HttpError(400, 'done は true か false です');
    values[':done'] = patch.done;
    sets.push('done = :done');
  }
  if (sets.length === 0) throw new HttpError(400, '変更する項目がありません');
  try {
    const { Attributes } = await docs.send(new UpdateCommand({
      TableName: TABLE,
      Key: { id },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: 'attribute_exists(id)',
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }));
    if (notify) await publish(patch.done === undefined ? 'renamed' : patch.done ? 'completed' : 'reopened', Attributes);
    return Attributes;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) throw new HttpError(404, 'Todo が見つかりません');
    throw error;
  }
}

export async function remove(id) {
  try {
    const { Attributes } = await docs.send(new DeleteCommand({
      TableName: TABLE,
      Key: { id },
      ConditionExpression: 'attribute_exists(id)',
      ReturnValues: 'ALL_OLD',
    }));
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `notes/${id}.txt` }));
    await publish('deleted', Attributes);
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) throw new HttpError(404, 'Todo が見つかりません');
    throw error;
  }
}

export async function getNote(id) {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: `notes/${id}.txt` }));
    return await out.Body.transformToString();
  } catch (error) {
    if (error instanceof NoSuchKey) return '';
    throw error;
  }
}

export async function putNote(id, text, notify = true) {
  if (typeof text !== 'string') throw new HttpError(400, 'メモは文字列です');
  if ([...text].length > MAX_NOTE) throw new HttpError(400, `メモは ${MAX_NOTE} 文字以内にしてください`);
  const hasNote = text !== '';
  // Keep hasNote on the item in step with the object in S3.
  let item;
  try {
    ({ Attributes: item } = await docs.send(new UpdateCommand({
      TableName: TABLE,
      Key: { id },
      UpdateExpression: 'SET hasNote = :n',
      ConditionExpression: 'attribute_exists(id)',
      ExpressionAttributeValues: { ':n': hasNote },
      ReturnValues: 'ALL_NEW',
    })));
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) throw new HttpError(404, 'Todo が見つかりません');
    throw error;
  }
  if (hasNote) {
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: `notes/${id}.txt`,
      Body: text,
      ContentType: 'text/plain; charset=utf-8',
    }));
  } else {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `notes/${id}.txt` }));
  }
  if (notify) await publish('noted', item);
  return item;
}

/** Takes the change events waiting in the queue (oldest first) and removes them. */
export async function drainActivity() {
  const events = [];
  for (;;) {
    const { Messages = [] } = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10 }));
    if (Messages.length === 0) break;
    events.push(...Messages.map((m) => JSON.parse(m.Body)));
    await sqs.send(new DeleteMessageBatchCommand({
      QueueUrl: queueUrl,
      Entries: Messages.map((m, i) => ({ Id: String(i), ReceiptHandle: m.ReceiptHandle })),
    }));
  }
  return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
