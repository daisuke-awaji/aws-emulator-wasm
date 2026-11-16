// The API as a plain Node.js HTTP server: what a Lambda Web Function runs. Lambda starts
// the package's index.js, which must listen on AWS_LAMBDA_HTTP_ENDPOINT ("host:port")
// within 10 seconds; requests then arrive as ordinary HTTP/1.1, so the Hono app needs no
// Lambda adapter, and no API Gateway sits in front.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

/** One set of clients per process: the environment serves many requests concurrently. */
export function createClients(clientConfig = {}) {
  const ddb = new DynamoDBClient(clientConfig);
  return {
    ddb,
    docs: DynamoDBDocumentClient.from(ddb, { marshallOptions: { removeUndefinedValues: true } }),
    s3: new S3Client(clientConfig),
    sqs: new SQSClient(clientConfig),
  };
}

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * The app with clients and resource names from the environment:
 * TABLE_NAME, BUCKET_NAME, QUEUE_URL (set them on the revision's serviceConfig).
 * @param {{ clientConfig?: object, env?: Record<string, string | undefined> }} [options]
 *   clientConfig: extra SDK settings (the tests point them at the emulator).
 */
export function createServerApp({ clientConfig, env = process.env } = {}) {
  const { docs, s3, sqs } = createClients(clientConfig);
  return createApp({
    docs,
    s3,
    sqs,
    table: required(env, 'TABLE_NAME'),
    bucket: required(env, 'BUCKET_NAME'),
    queueUrl: required(env, 'QUEUE_URL'),
    // Lambda puts the request id in lambda-web-request-id; log it with the error.
    log: (error, c) => console.error(JSON.stringify({
      level: 'ERROR',
      requestId: c?.req.header('lambda-web-request-id'),
      error: `${error?.name}: ${error?.message}`,
      stack: error?.stack,
    })),
  });
}

/**
 * Starts the HTTP server on `address` ("host:port"; port 0 picks a free one).
 * Resolves with the server once it is listening.
 */
export function listen(app, address = process.env.AWS_LAMBDA_HTTP_ENDPOINT || 'localhost:3000') {
  const i = address.lastIndexOf(':');
  const hostname = address.slice(0, i);
  const port = Number(address.slice(i + 1));
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname, port }, () => resolve(server));
    server.once('error', reject);
  });
}
