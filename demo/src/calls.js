// A log of the SDK calls the emulator answered, for the "SDK calls" panel (CallLog.jsx).
// Each call is tagged with the REST API request (MSW handler) that made it, and with the
// SDK execution behind it: client, command, input and output (see instrument()).
import { t } from './i18n.js';

const KEEP = 500;
const log = [];
const active = new Map(); // route tag -> number of running handlers
let setupRunning = false;
const running = new Map(); // SDK execution id -> execution, until its HTTP call is answered
let nextId = 0;

/** The request header that ties an HTTP call to the SDK execution that sent it. */
export const CALL_HEADER = 'x-demo-sdk-call';

const MAX_STRING = 300;
const MAX_ITEMS = 20;

/** A JSON-safe copy of SDK input or output, with long strings, arrays and bodies cut short. */
export function snapshot(value, depth = 0) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') {
    const chars = [...value];
    return chars.length > MAX_STRING ? t('snap.chars', chars.slice(0, MAX_STRING).join(''), chars.length) : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return t('snap.bytes', value.byteLength);
  if (typeof value.transformToString === 'function' || value instanceof ReadableStream || value instanceof Blob) return t('snap.stream');
  if (depth >= 6) return '…';
  if (value instanceof Set) value = [...value];
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ITEMS).map((v) => snapshot(v, depth + 1));
    if (value.length > MAX_ITEMS) out.push(t('snap.more', value.length - MAX_ITEMS));
    return out;
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === '$metadata' || v === undefined || typeof v === 'function') continue;
      out[k] = snapshot(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/**
 * Records every client.send(): which command with which input, and what came back.
 * The name comes from the SDK (context.commandName), as class names do not survive minifying.
 * A lib-dynamodb command wraps the low-level one: PutItemCommand is sent for PutCommand.
 */
export function instrument(client, clientName) {
  const send = client.send.bind(client);
  client.send = async (command, ...rest) => {
    const id = String(++nextId);
    const execution = {
      client: clientName,
      command: '',
      input: snapshot(command.input),
      route: tag(),
    };
    running.set(id, execution);
    // Tag the HTTP request, so that recordCall() can find this execution.
    command.middlewareStack.add(
      (next, context) => (args) => {
        const name = context.commandName ?? '';
        execution.command = command.clientCommand ? name.replace(/Items?Command$/, 'Command') : name;
        args.request.headers[CALL_HEADER] = id;
        return next(args);
      },
      { step: 'build', name: 'demoSdkCallId', override: true },
    );
    const started = performance.now();
    try {
      const output = await send(command, ...rest);
      execution.output = snapshot(output);
      return output;
    } catch (error) {
      execution.error = { name: error.name, message: error.message };
      throw error;
    } finally {
      execution.ms = performance.now() - started;
      running.delete(id);
    }
  };
  return client;
}

const header = (headers, name) => headers.find(([k]) => k.toLowerCase() === name)?.[1];

/** Service and operation of a signed SDK request, e.g. { service: 'DynamoDB', operation: 'PutItem' }. */
export function describeCall({ method, url, headers }) {
  const scope = /Credential=[^/]+\/\d{8}\/[^/]+\/([^/]+)\//.exec(header(headers, 'authorization') ?? '')?.[1];
  const target = header(headers, 'x-amz-target');
  const service = { dynamodb: 'DynamoDB', s3: 'S3', sqs: 'SQS' }[scope] ?? scope ?? '?';
  if (target) return { service, operation: target.split('.').pop() };
  const { pathname, searchParams } = new URL(url);
  const op = searchParams.get('x-id');
  if (op) return { service, operation: op };
  const parts = pathname.split('/').filter(Boolean);
  if (service === 'S3' && parts.length === 1) {
    return { service, operation: { PUT: 'CreateBucket', DELETE: 'DeleteBucket', GET: 'ListObjectsV2', HEAD: 'HeadBucket' }[method] ?? method };
  }
  return { service, operation: `${method} ${pathname}` };
}

function tag() {
  if (setupRunning) return 'setup';
  if (active.size === 1) return [...active.keys()][0];
  return active.size ? 'concurrent' : 'other';
}

/** Pass as createEmulator({ onCall }). */
export function recordCall(call) {
  // The execution is shared, so its output (filled in when send() returns) shows up here too.
  const sdk = running.get(header(call.headers, CALL_HEADER)) ?? null;
  log.push({ seq: call.seq, ...describeCall(call), status: call.status, ms: call.ms, route: sdk?.route ?? tag(), sdk });
  if (log.length > KEEP) log.splice(0, log.length - KEEP);
}

/** Calls answered after `seq` (oldest first). */
export const callsSince = (seq) => log.filter((c) => c.seq > seq);

/** Runs fn with calls tagged as made by `route`, e.g. 'POST /api/todos'. */
export async function inRoute(route, fn) {
  active.set(route, (active.get(route) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    const n = active.get(route) - 1;
    if (n) active.set(route, n);
    else active.delete(route);
  }
}

/** Runs fn with calls tagged as the one-time setup. */
export async function inSetup(fn) {
  setupRunning = true;
  try {
    return await fn();
  } finally {
    setupRunning = false;
  }
}
