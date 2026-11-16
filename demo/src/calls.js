// A log of the SDK calls the emulator answered, for the "SDK の呼び出し" panel.
// Each call is tagged with the REST API request (MSW handler) that made it.

const KEEP = 500;
const log = [];
const active = new Map(); // route tag -> number of running handlers
let setupRunning = false;

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
  log.push({ seq: call.seq, ...describeCall(call), status: call.status, ms: call.ms, route: tag() });
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
