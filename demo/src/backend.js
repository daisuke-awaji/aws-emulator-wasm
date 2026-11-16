// Wires the API (../api, the code that also runs on Lambda) to the in-browser emulator:
// the first request creates the table, bucket, queue and seed Todos, or, when the
// emulator restored its saved state, just looks the queue up again.
import { GetQueueUrlCommand } from '@aws-sdk/client-sqs';
import { createApp } from '../api/app.js';
import { NAMES, provision } from '../api/provision.js';
import { inSetup } from './calls.js';
import { ddb, docs, emulator, s3, sqs } from './emulator.js';
import { t } from './i18n.js';

/**
 * The one user of the in-browser API. There is no sign-in here: the data never leaves
 * this browser. The AWS build signs users in with Cognito instead (api/server.js).
 */
export const LOCAL_USER = 'local-user';

async function setup() {
  const { persistence } = await emulator.ready;
  let config;
  if (persistence?.restored) {
    // The table, bucket, queue and Todos came back with the emulator's saved memory.
    const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: NAMES.queue }));
    config = { table: NAMES.table, bucket: NAMES.bucket, queueUrl: QueueUrl };
  } else {
    // Seeds are in the language of the page at first start (they are data from then on).
    config = await provision({ ddb, docs, s3, sqs }, { user: LOCAL_USER, seeds: t('seeds') });
  }
  // exposeErrors: an emulator failure shows its message in the page.
  return createApp({ docs, s3, sqs, ...config, authenticate: () => LOCAL_USER, exposeErrors: true });
}

let app;
/** The Hono app, once the emulator is set up (once per page). */
export const getApp = () => (app ??= inSetup(setup));
