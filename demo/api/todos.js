// The Todo service: plain functions over the AWS SDK, with no idea where they run.
// Todos live in DynamoDB, notes in S3, and every change is published to SQS. Every
// operation belongs to one user: the table is keyed by (userId, id), and notes are stored
// under the user's prefix.
//
// The same code runs in the browser (clients pointed at the wasm emulator) and in the
// Lambda Web Function (default clients). Everything environment-specific comes in through
// createTodos().
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand } from '@aws-sdk/client-s3';
import { ChangeMessageVisibilityBatchCommand, DeleteMessageBatchCommand, ReceiveMessageCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DeleteCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ApiError } from './errors.js';

export const MAX_TITLE = 200;
export const MAX_NOTE = 10_000;
/** Receive rounds per drain (10 messages each): the queue is shared, so bound the scan. */
const MAX_DRAIN_ROUNDS = 10;

/** A Todo as the API returns it (the partition key stays inside). */
const view = ({ userId, ...todo }) => todo;

/**
 * @param {{
 *   docs: import('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient,
 *   s3: import('@aws-sdk/client-s3').S3Client,
 *   sqs: import('@aws-sdk/client-sqs').SQSClient,
 *   table: string, bucket: string, queueUrl: string,
 * }} deps
 * @returns {(userId: string) => ReturnType<typeof forUser>}
 */
export function createTodos(deps) {
  return (userId) => {
    if (typeof userId !== 'string' || userId === '') throw new ApiError(401, 'UNAUTHORIZED');
    return forUser(deps, userId);
  };
}

function forUser({ docs, s3, sqs, table, bucket, queueUrl }, userId) {
  const noteKey = (id) => `notes/${userId}/${id}.txt`;
  const key = (id) => ({ userId, id });

  async function publish(type, todo) {
    await sqs.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ type, userId, id: todo.id, title: todo.title, at: new Date().toISOString() }),
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
      const page = await docs.send(new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'userId = :u',
        ExpressionAttributeValues: { ':u': userId },
        ExclusiveStartKey,
      }));
      items.push(...page.Items);
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items.map(view).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  /** options.createdAt and options.notify: false are for seeding. */
  async function create(input, { createdAt = new Date().toISOString(), notify = true } = {}) {
    const todo = { userId, id: crypto.randomUUID(), title: checkTitle(input?.title), done: false, hasNote: false, createdAt };
    await docs.send(new PutCommand({ TableName: table, Item: todo }));
    if (notify) await publish('created', todo);
    return view(todo);
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
        Key: key(id),
        UpdateExpression: `SET ${sets.join(', ')}`,
        ConditionExpression: 'attribute_exists(id)',
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      })),
    );
    if (notify) await publish(patch.done === undefined ? 'renamed' : patch.done ? 'completed' : 'reopened', Attributes);
    return view(Attributes);
  }

  async function remove(id) {
    const { Attributes } = await onExisting(() =>
      docs.send(new DeleteCommand({
        TableName: table,
        Key: key(id),
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
        Key: key(id),
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
    return view(item);
  }

  /**
   * Takes this user's change events waiting in the queue (oldest first) and removes them.
   * The queue is shared: other users' events stay invisible until the drain ends, so each
   * round sees messages it has not seen yet, and then they are released together.
   */
  async function drainActivity() {
    const events = [];
    const others = [];
    try {
      await receiveRounds(events, others);
    } finally {
      await release(others);
    }
    return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }

  const entries = (list) => list.map((m, i) => ({ Id: String(i), ReceiptHandle: m.ReceiptHandle }));

  /** Makes other users' messages visible again, 10 per batch (the SQS limit). */
  async function release(messages) {
    for (let i = 0; i < messages.length; i += 10) {
      await sqs.send(new ChangeMessageVisibilityBatchCommand({
        QueueUrl: queueUrl,
        Entries: entries(messages.slice(i, i + 10)).map((e) => ({ ...e, VisibilityTimeout: 0 })),
      }));
    }
  }

  async function receiveRounds(events, others) {
    for (let round = 0; round < MAX_DRAIN_ROUNDS; round++) {
      // The first receive long-polls briefly: SQS short polling samples only some servers,
      // so it can come back empty while a message is waiting. Later rounds just finish off.
      const { Messages = [] } = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: round === 0 ? 1 : 0,
      }));
      if (Messages.length === 0) break;
      const mine = [];
      for (const m of Messages) {
        let event;
        try {
          event = JSON.parse(m.Body);
        } catch {
          event = undefined;
        }
        if (event?.userId === userId) {
          mine.push(m);
          const { userId: _, ...rest } = event;
          events.push(rest);
        } else others.push(m);
      }
      if (mine.length) await sqs.send(new DeleteMessageBatchCommand({ QueueUrl: queueUrl, Entries: entries(mine) }));
    }
  }

  return { list, create, update, remove, getNote, putNote, drainActivity };
}
