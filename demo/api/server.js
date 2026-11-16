// The API as a plain Node.js HTTP server: what a Lambda Web Function runs. Lambda starts
// the package's index.js, which must listen on AWS_LAMBDA_HTTP_ENDPOINT ("host:port")
// within 10 seconds; requests then arrive as ordinary HTTP/1.1, so the Hono app needs no
// Lambda adapter, and no API Gateway sits in front.
//
// The endpoint is ApplicationManaged (a browser cannot sign SigV4), so this server is the
// gate: every /api request needs a Cognito access token from the configured user pool and
// app client, and CORS admits only the configured origins.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { serve } from '@hono/node-server';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import {
  FetchError,
  JwksNotAvailableInCacheError,
  JwksValidationError,
  JwtBaseError,
  NotSupportedError,
  ParameterValidationError,
} from 'aws-jwt-verify/error';
import { cors } from 'hono/cors';
import { createApp } from './app.js';
import { ApiError } from './errors.js';

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

/** Errors that say nothing about the token: the keys could not be fetched, or the setup is wrong. */
const NOT_THE_TOKEN = [FetchError, JwksNotAvailableInCacheError, JwksValidationError, NotSupportedError, ParameterValidationError];

/**
 * Checks `Authorization: Bearer <access token>` and returns the user's `sub`. No header,
 * another scheme, or a token that fails verification is a 401. A failure to check at all
 * (e.g. the JWKS fetch times out) is rethrown and answered 500, so it does not look like
 * the user's session ended.
 * @param {{ verify: (token: string) => Promise<{ sub: string }> }} verifier
 */
export const bearerAuth = (verifier) => async (c) => {
  const match = /^Bearer (\S+)$/.exec(c.req.header('authorization') ?? '');
  if (!match) throw new ApiError(401, 'UNAUTHORIZED');
  let payload;
  try {
    payload = await verifier.verify(match[1]);
  } catch (error) {
    if (error instanceof JwtBaseError && !NOT_THE_TOKEN.some((E) => error instanceof E)) throw new ApiError(401, 'UNAUTHORIZED');
    throw error;
  }
  return payload.sub;
};

/**
 * The app with clients, names and the gate from the environment (set on the revision):
 *   TABLE_NAME, BUCKET_NAME, QUEUE_URL     the resources
 *   COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID whose access tokens are accepted
 *   ALLOWED_ORIGINS                        comma-separated origins for CORS
 * Missing settings stop the server from starting rather than serving without a gate.
 * @param {{ clientConfig?: object, env?: Record<string, string | undefined>, verifier?: { verify(token: string): Promise<{ sub: string }> } }} [options]
 *   clientConfig: extra SDK settings (the tests point them at the emulator).
 *   verifier: replaces the Cognito verifier (tests only).
 */
export function createServerApp({ clientConfig, env = process.env, verifier } = {}) {
  const { docs, s3, sqs } = createClients(clientConfig);
  const origins = required(env, 'ALLOWED_ORIGINS').split(',').map((o) => o.trim()).filter(Boolean);
  const tokens =
    verifier ??
    CognitoJwtVerifier.create({
      userPoolId: required(env, 'COGNITO_USER_POOL_ID'),
      clientId: required(env, 'COGNITO_CLIENT_ID'),
      tokenUse: 'access',
    });
  return createApp({
    docs,
    s3,
    sqs,
    table: required(env, 'TABLE_NAME'),
    bucket: required(env, 'BUCKET_NAME'),
    queueUrl: required(env, 'QUEUE_URL'),
    authenticate: bearerAuth(tokens),
    middleware: [
      cors({
        origin: (origin) => (origins.includes(origin) ? origin : null),
        allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: 600,
      }),
    ],
    // Lambda puts the request id in lambda-web-request-id; log it with the error.
    log: (error, c) =>
      console.error(JSON.stringify({
        level: 'ERROR',
        requestId: c?.req.header('lambda-web-request-id'),
        error: `${error?.name}: ${error?.message}`,
        stack: error?.stack,
      })),
  });
}

/**
 * Starts the HTTP server on `address` ("host:port"; port 0 picks a free one). Lambda sets
 * AWS_LAMBDA_HTTP_ENDPOINT; elsewhere it defaults to loopback.
 * Resolves with the server once it is listening.
 */
export function listen(app, address = process.env.AWS_LAMBDA_HTTP_ENDPOINT || '127.0.0.1:3000') {
  const i = address.lastIndexOf(':');
  const hostname = address.slice(0, i);
  const port = Number(address.slice(i + 1));
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname, port }, () => resolve(server));
    server.once('error', reject);
  });
}
