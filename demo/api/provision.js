// Creates what the API expects to exist: the table, the bucket and the queue, plus seed
// Todos for one user. Only for an empty emulator (the browser demo and the tests); in AWS
// these come from the CDK stack in ../../infra, with the names handed to the API
// (see server.js).
import { CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { CreateBucketCommand } from '@aws-sdk/client-s3';
import { CreateQueueCommand } from '@aws-sdk/client-sqs';
import { createTodos } from './todos.js';

export const NAMES = { table: 'todos', bucket: 'todo-notes', queue: 'todo-activity' };

/**
 * @param {{ ddb, docs, s3, sqs }} clients
 * @param {{ seeds?: { title: string, done?: boolean, note?: string }[], user?: string }} [options]
 *   user: whose seed Todos these are.
 * @returns {Promise<{ table: string, bucket: string, queueUrl: string }>}
 */
export async function provision({ ddb, docs, s3, sqs }, { seeds = [], user } = {}) {
  // The same key schema as the CDK stack: one partition per user.
  await ddb.send(new CreateTableCommand({
    TableName: NAMES.table,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'id', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'userId', KeyType: 'HASH' },
      { AttributeName: 'id', KeyType: 'RANGE' },
    ],
  }));
  // The table is CREATING at first; DescribeTable answers once it is ACTIVE.
  await ddb.send(new DescribeTableCommand({ TableName: NAMES.table }));
  await s3.send(new CreateBucketCommand({ Bucket: NAMES.bucket }));
  const { QueueUrl: queueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: NAMES.queue }));
  const config = { table: NAMES.table, bucket: NAMES.bucket, queueUrl };

  if (seeds.length) {
    if (!user) throw new TypeError('provision: seeds need a user');
    const todos = createTodos({ docs, s3, sqs, ...config })(user);
    for (const [i, seed] of seeds.entries()) {
      const todo = await todos.create({ title: seed.title }, { createdAt: new Date(Date.UTC(2026, 10, 16, 0, 0, i)).toISOString(), notify: false });
      if (seed.done) await todos.update(todo.id, { done: true }, { notify: false });
      if (seed.note) await todos.putNote(todo.id, seed.note, { notify: false });
    }
  }
  return config;
}
