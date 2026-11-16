import { expect, test } from '@playwright/test';

// The demo speaks English and Japanese: the browser language picks one, the switch in the
// header changes it in place, and the choice is remembered.

const items = (page, name) => page.getByRole('list', { name }).locator(':scope > li');

test.describe('an English browser', () => {
  test.use({ locale: 'en-US' });

  test('gets the English UI, seed data and API messages', async ({ page }) => {
    await page.goto('./');
    await expect(items(page, 'Todo list')).toHaveText([/Build the AWS Emulator to wasm/, /Run it in a browser Worker/, /Call DynamoDB, S3 and SQS/], {
      timeout: 60_000,
    });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveTitle(/AWS Emulator in the browser/);
    await expect(page.getByText('1 left / 3 total')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');

    await page.getByLabel('New todo').fill('Buy milk');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(items(page, 'Todo list').filter({ hasText: 'Buy milk' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'SDK calls for Add “Buy milk”' }).getByRole('listitem')).toHaveCount(6);
    await expect(page.getByTestId('last-calls')).toHaveText('6 calls');

    await page.getByLabel('New todo').fill('   ');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Enter a title');
  });
});

test('the switch changes the language in place and is remembered', async ({ page }) => {
  await page.goto('./');
  const ja = items(page, 'Todo の一覧');
  await expect(ja).toHaveCount(3, { timeout: 60_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');

  await page.getByRole('group', { name: '言語' }).getByRole('button', { name: 'EN' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  // The data stays as it was saved; only the UI around it changes.
  await expect(items(page, 'Todo list')).toHaveCount(3);
  await expect(page.getByText('1 left / 3 total')).toBeVisible();
  // Labels already in the call log follow the switch.
  await expect(page.getByRole('list', { name: /^SDK calls for Start/ })).toBeVisible();

  await page.reload();
  await expect(items(page, 'Todo list')).toHaveCount(3, { timeout: 60_000 });
  await page.goto('sdk.html');
  await expect(page.getByRole('heading', { name: 'SDK round trips' })).toBeVisible();
  await page.getByRole('button', { name: '日本語' }).click();
  await expect(page.getByRole('heading', { name: 'SDK の往復テスト' })).toBeVisible();
  await expect(page.locator('#status')).toHaveText(/^(pass|fail)$/, { timeout: 60_000 });
});

test('?lang= picks the language for a shared link', async ({ page }) => {
  await page.goto('./?lang=en');
  await expect(items(page, 'Todo list')).toHaveCount(3, { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Todos' })).toBeVisible();
});
