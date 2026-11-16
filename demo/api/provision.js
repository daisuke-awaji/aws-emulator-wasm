// Creates what the API expects to exist: the table, the bucket and the queue, plus seed
// Todos. Only for an empty emulator (the browser demo and the tests); in AWS these come
// from your infrastructure code, with the names handed to the API (see server.js).
import { CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { CreateBucketCommand } from '@aws-sdk/client-s3';
import { CreateQueueCommand } from '@aws-sdk/client-sqs';
import { createTodos } from './todos.js';

export const NAMES = { table: 'todos', bucket: 'todo-notes', queue: 'todo-activity' };

/**
 * @param {{ ddb, docs, s3, sqs }} clients
 * @param {{ seeds?: { title: string, done?: boolean, note?: string }[] }} [options]
 * @returns {Promise<{ table: string, bucket: string, queueUrl: string }>}
 */
export async function provision({ ddb, docs, s3, sqs }, { seeds = [] } = {}) {
  await ddb.send(new CreateTableCommand({
    TableName: NAMES.table,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
  }));
  // The table is CREATING at first; DescribeTable answers once it is ACTIVE.
  await ddb.send(new DescribeTableCommand({ TableName: NAMES.table }));
  await s3.send(new CreateBucketCommand({ Bucket: NAMES.bucket }));
  const { QueueUrl: queueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: NAMES.queue }));
  const config = { table: NAMES.table, bucket: NAMES.bucket, queueUrl };

  const todos = createTodos({ docs, s3, sqs, ...config });
  for (const [i, seed] of seeds.entries()) {
    const todo = await todos.create({ title: seed.title }, { createdAt: new Date(Date.UTC(2026, 10, 16, 0, 0, i)).toISOString(), notify: false });
    if (seed.done) await todos.update(todo.id, { done: true }, { notify: false });
    if (seed.note) await todos.putNote(todo.id, seed.note, { notify: false });
  }
  return config;
}
