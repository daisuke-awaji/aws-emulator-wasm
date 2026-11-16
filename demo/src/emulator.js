// The one emulator for this page: a Web Worker running the wasm build, and SDK clients
// that send every call to it.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createEmulator } from 'aws-emulator-wasm/browser';
import { instrument, recordCall } from './calls.js';

const started = performance.now();

export const emulator = createEmulator({
  wasmUrl: `${import.meta.env.BASE_URL}aws-emulator.wasm`,
  onLog: (stream, line) => (stream === 'stderr' ? console.warn : console.log)(`[aws-emulator] ${line}`),
  onCall: recordCall,
});

/** Milliseconds from page start until the emulator was ready. */
export const readyIn = emulator.ready.then(() => performance.now() - started);

const config = emulator.clientConfig();
// The variable names are the ones backend.js uses; the call log shows them, e.g. docs.send(PutCommand).
export const ddb = instrument(new DynamoDBClient(config), 'ddb');
export const docs = instrument(DynamoDBDocumentClient.from(ddb, { marshallOptions: { removeUndefinedValues: true } }), 'docs');
export const s3 = instrument(new S3Client({ ...config, forcePathStyle: true }), 's3');
export const sqs = instrument(new SQSClient(config), 'sqs');
