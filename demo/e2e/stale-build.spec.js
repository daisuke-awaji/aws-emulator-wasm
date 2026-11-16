import { expect, test } from '@playwright/test';

// A page from an earlier deploy: its chunks are gone (404). It reloads once to get the
// current index.html; if the reload does not help, it shows the error and stops.
test.use({ storageState: { cookies: [], origins: [] }, locale: 'en-US' });

const chunk = /\/assets\/emulator-[\w-]+\.js$/;

test('a chunk that is gone reloads the page once, and the emulator starts', async ({ page }) => {
  let gone = true;
  await page.route(chunk, (route) => (gone ? route.fulfill({ status: 404, body: 'Not Found' }) : route.continue()));
  await page.goto('./');
  const reloaded = page.waitForEvent('framenavigated', { predicate: (f) => f === page.mainFrame() });
  const served = page.waitForResponse((r) => chunk.test(new URL(r.url()).pathname) && r.status() === 404);
  await page.getByRole('button', { name: 'Download and start' }).click();
  await served;
  gone = false; // The reloaded page is the current deploy.
  await reloaded;
  const items = page.getByRole('list', { name: 'Todo list' }).locator(':scope > li');
  await expect(items).toHaveCount(3, { timeout: 60_000 });
});

test('a chunk that stays gone shows the error after one reload', async ({ page }) => {
  let loads = 0;
  page.on('load', () => loads++);
  await page.route(chunk, (route) => route.fulfill({ status: 404, body: 'Not Found' }));
  await page.goto('./');
  await page.getByRole('button', { name: 'Download and start' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'start' }).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  expect(loads).toBe(2);
});
