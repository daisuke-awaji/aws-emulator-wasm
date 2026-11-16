// The one emulator for this page: a Web Worker running the wasm build, and SDK clients
// that send every call to it.
//
// A page with <meta name="aws-emulator-persist" content="NAME"> keeps the emulator's state
// across reloads (the Todo page does; the SDK test page starts empty every time).
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createEmulator } from 'aws-emulator-wasm/browser';
// The wasm that ships with the package; Vite serves it and copies it into the build.
import wasmUrl from 'aws-emulator-wasm/aws-emulator.wasm?url';
import { instrument, recordCall } from './calls.js';

const started = performance.now();
const persistName = document.querySelector('meta[name="aws-emulator-persist"]')?.content;
// Set by "Use it in this tab" before reloading: start at once, and stop the other tab.
const TAKE_OVER = 'aws-emulator-take-over';
const takeOver = sessionStorage.getItem(TAKE_OVER) === '1';
sessionStorage.removeItem(TAKE_OVER);

const listeners = new Set();
/**
 * What the page shows about the emulator outside the REST API (see App.jsx):
 * lock: 'waiting' | 'held' | 'lost' | undefined; lastSave: { at, ms, bytes }; saveError.
 */
export const live = {
  lock: undefined,
  lastSave: undefined,
  saveError: undefined,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
const update = (patch) => {
  Object.assign(live, patch);
  for (const fn of listeners) fn();
};

export const emulator = createEmulator({
  wasmUrl,
  persist: persistName ? { name: persistName, takeOver } : false,
  onLog: (stream, line) => (stream === 'stderr' ? console.warn : console.log)(`[aws-emulator] ${line}`),
  onCall: recordCall,
  onLock: (lock) => update({ lock }),
  onSave: (event) => update(event.error ? { saveError: event.error } : { lastSave: event, saveError: undefined }),
});

/** Reloads the page as the tab that runs the emulator (the other tab stops). */
export function reloadAndTakeOver() {
  sessionStorage.setItem(TAKE_OVER, '1');
  location.reload();
}

/** Deletes the saved state and reloads: the page starts over from the seed data. */
export async function resetAndReload() {
  await emulator.reset();
  location.reload();
}

/** Milliseconds from page start until the emulator was ready, and what was restored. */
export const readyIn = emulator.ready.then((stats) => ({ ms: performance.now() - started, persistence: stats.persistence }));

const config = emulator.clientConfig();
// The variable names are the ones api/todos.js uses; the call log shows them, e.g. docs.send(PutCommand).
export const ddb = instrument(new DynamoDBClient(config), 'ddb');
export const docs = instrument(DynamoDBDocumentClient.from(ddb, { marshallOptions: { removeUndefinedValues: true } }), 'docs');
export const s3 = instrument(new S3Client({ ...config, forcePathStyle: true }), 's3');
export const sqs = instrument(new SQSClient(config), 'sqs');
