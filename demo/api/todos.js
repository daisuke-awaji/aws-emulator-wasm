// The Todo service: plain functions over the AWS SDK, with no idea where they run.
// Todos live in DynamoDB, notes in S3, and every change is published to SQS.
//
// The same code runs in the browser (clients pointed at the wasm emulator) and in
// Lambda (default clients). Everything environment-specific comes in through createTodos().
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand } from '@aws-sdk/client-s3';
import { DeleteMessageBatchCommand, ReceiveMessageCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DeleteCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ApiError } from './errors.js';

export const MAX_TITLE = 200;
export const MAX_NOTE = 10_000;

/**
 * @param {{
 *   docs: import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient,
 *   s3: import('@aws-sdk/client-s3').S3Client,
 *   sqs: import('@aws-sdk/client-sqs').SQSClient,
 *   table: string, bucket: string, queueUrl: string,
 * }} deps
 */
export function createTodos({ docs, s3, sqs, table, bucket, queueUrl }) {
  const noteKey = (id) => `notes/${id}.txt`;

  async function publish(type, todo) {
    await sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ type, id: todo.id, title: todo.title, at: new Date().toISOString() }),
    }));
  }

  function checkTitle(title) {
    if (typeof title !== 'string' || title.trim() === '') throw new ApiError(400, 'TITLE_REQUIRED');
    if ([...title.trim()].length > MAX_TITLE) throw new ApiError(400, 'TITLE_TOO_LONG', { max: MAX_TITLE });
    return title.trim();
  }

  /** Runs a conditional write on an existing Todo; a missing one is a 404. */
  async function onExisting(fn) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) throw new ApiError(404, 'NOT_FOUND');
      throw error;
    }
  }

  async function list() {
    const items = [];
    let ExclusiveStartKey;
    do {
      const page = await docs.send(new ScanCommand({ TableName: table, ExclusiveStartKey }));
      items.push(...page.Items);
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  /** options.createdAt and options.notify: false are for seeding. */
  async function create(input, { createdAt = new Date().toISOString(), notify = true } = {}) {
    const todo = { id: crypto.randomUUID(), title: checkTitle(input?.title), done: false, hasNote: false, createdAt };
    await docs.send(new PutCommand({ TableName: table, Item: todo }));
    if (notify) await publish('created', todo);
    return todo;
  }

  async function update(id, patch, { notify = true } = {}) {
    const sets = [];
    const values = {};
    if (patch?.title !== undefined) {
      values[':title'] = checkTitle(patch.title);
      sets.push('title = :title');
    }
    if (patch?.done !== undefined) {
      if (typeof patch.done !== 'boolean') throw new ApiError(400, 'DONE_NOT_BOOLEAN');
      values[':done'] = patch.done;
      sets.push('done = :done');
    }
    if (sets.length === 0) throw new ApiError(400, 'NOTHING_TO_CHANGE');
    const { Attributes } = await onExisting(() =>
      docs.send(new UpdateCommand({
        TableName: table,
        Key: { id },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ConditionExpression: 'attribute_exists(id)',
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      })),
    );
    if (notify) await publish(patch.done === undefined ? 'renamed' : patch.done ? 'completed' : 'reopened', Attributes);
    return Attributes;
  }

  async function remove(id) {
    const { Attributes } = await onExisting(() =>
      docs.send(new DeleteCommand({
        TableName: table,
        Key: { id },
        ConditionExpression: 'attribute_exists(id)',
        ReturnValues: 'ALL_OLD',
      })),
    );
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: noteKey(id) }));
    await publish('deleted', Attributes);
  }

  async function getNote(id) {
    try {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: noteKey(id) }));
      return await out.Body.transformToString();
    } catch (error) {
      if (error instanceof NoSuchKey) return '';
      throw error;
    }
  }

  async function putNote(id, text, { notify = true } = {}) {
    if (typeof text !== 'string') throw new ApiError(400, 'NOTE_NOT_STRING');
    if ([...text].length > MAX_NOTE) throw new ApiError(400, 'NOTE_TOO_LONG', { max: MAX_NOTE });
    const hasNote = text !== '';
    // Keep hasNote on the item in step with the object in S3.
    const { Attributes: item } = await onExisting(() =>
      docs.send(new UpdateCommand({
        TableName: table,
        Key: { id },
        UpdateExpression: 'SET hasNote = :n',
        ConditionExpression: 'attribute_exists(id)',
        ExpressionAttributeValues: { ':n': hasNote },
        ReturnValues: 'ALL_NEW',
      })),
    );
    if (hasNote) {
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: noteKey(id),
        Body: text,
        ContentType: 'text/plain; charset=utf-8',
      }));
    } else {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: noteKey(id) }));
    }
    if (notify) await publish('noted', item);
    return item;
  }

  /** Takes the change events waiting in the queue (oldest first) and removes them. */
  async function drainActivity() {
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

  return { list, create, update, remove, getNote, putNote, drainActivity };
}
