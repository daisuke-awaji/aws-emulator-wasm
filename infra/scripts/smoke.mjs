// End-to-end check of a deployed stack through the real page: signs a temporary Cognito
// user in on the Cognito sign-in page, adds, completes, notes and deletes a todo, checks
// that the API turns away anonymous callers, then signs out and deletes the user.
//
//   node scripts/smoke.mjs [page URL]     (default http://localhost:5173/)
//
// The page must be built against the stack (npm run dev:aws -w demo, which reads
// demo/.env.aws.local), and its URL must be one of the stack's appUrls. Needs AWS
// credentials allowed to create and delete users in the pool.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { chromium } from '@playwright/test';

const outputs = JSON.parse(readFileSync(resolve(import.meta.dirname, '../cdk-outputs.json'), 'utf8')).TodoApi;
const pageUrl = process.argv[2] ?? 'http://localhost:5173/';
const region = outputs.UserPoolId.split('_')[0];
const cognito = new CognitoIdentityProviderClient({ region });

const email = `smoke-${randomBytes(4).toString('hex')}@example.com`;
// Meets the pool's policy: 12+ characters with upper, lower and digits.
const password = `Sm0ke-${randomBytes(12).toString('base64url')}Aa1`;
const step = (text) => console.log(`- ${text}`);

async function expectAnonymousDenied() {
  const res = await fetch(new URL('/api/todos', outputs.ApiUrl));
  if (res.status !== 401 || res.headers.get('www-authenticate') !== 'Bearer') {
    throw new Error(`anonymous GET /api/todos answered ${res.status} (want 401 with WWW-Authenticate: Bearer)`);
  }
  step('anonymous GET /api/todos: 401, WWW-Authenticate: Bearer');
}

await expectAnonymousDenied();
await cognito.send(new AdminCreateUserCommand({
  UserPoolId: outputs.UserPoolId,
  Username: email,
  MessageAction: 'SUPPRESS',
  UserAttributes: [{ Name: 'email', Value: email }, { Name: 'email_verified', Value: 'true' }],
}));
step(`created ${email}`);
const browser = await chromium.launch();
try {
  await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: outputs.UserPoolId, Username: email, Password: password, Permanent: true }));
  const page = await browser.newPage({ locale: 'en-US' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(pageUrl);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // The Cognito sign-in page (classic hosted UI).
  await page.waitForURL(/amazoncognito\.com/);
  await page.locator('input[name="username"]:visible').fill(email);
  await page.locator('input[name="password"]:visible').fill(password);
  await page.locator('[name="signInSubmitButton"]:visible').click();
  await page.waitForURL((url) => url.href.startsWith(pageUrl) && !url.searchParams.has('code'), { timeout: 30_000 });
  await page.getByText(email).waitFor();
  step('signed in through Cognito; back on the page');

  const list = page.getByRole('list', { name: 'Todo list' }).locator(':scope > li');
  await page.getByText('No todos.').waitFor();
  await page.getByLabel('New todo').fill('Smoke test');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await list.filter({ hasText: 'Smoke test' }).waitFor();
  await page.getByRole('list', { name: 'Change log' }).getByText('Smoke test').waitFor();
  step('added a todo (DynamoDB) and saw its event (SQS)');

  await page.getByRole('checkbox', { name: 'Mark “Smoke test” as done' }).check();
  await page.getByRole('checkbox', { name: 'Mark “Smoke test” as not done' }).waitFor();
  await page.getByRole('button', { name: 'Note for “Smoke test”' }).click();
  await page.getByLabel('Note (saved to S3)').fill('from the smoke test');
  await page.getByRole('button', { name: 'Save note' }).click();
  await page.getByRole('button', { name: 'Note for “Smoke test”' }).filter({ hasText: 'Has note' }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Note for “Smoke test”' }).click();
  const note = await page.getByLabel('Note (saved to S3)').inputValue();
  if (note !== 'from the smoke test') throw new Error(`note read back as ${JSON.stringify(note)}`);
  step('completed it, saved a note (S3), reloaded and read it back');

  await page.getByRole('button', { name: 'Delete “Smoke test”' }).click();
  await page.getByText('No todos.').waitFor();
  step('deleted it');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL((url) => url.href.startsWith(pageUrl));
  await page.getByRole('button', { name: 'Sign in' }).waitFor();
  step('signed out');
  if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
} finally {
  await browser.close();
  await cognito.send(new AdminDeleteUserCommand({ UserPoolId: outputs.UserPoolId, Username: email }));
  step(`deleted ${email}`);
}
await expectAnonymousDenied();
console.log('smoke test passed');
