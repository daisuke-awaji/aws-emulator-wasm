import { expect, test } from '@playwright/test';

// A first visit loads only the page: the wasm, the SDK and MSW come with the button.
test.use({ storageState: { cookies: [], origins: [] }, locale: 'en-US' });

test('the emulator downloads only when the user starts it, and starts by itself afterwards', async ({ page }) => {
  const heavy = [];
  page.on('request', (r) => {
    if (/\.wasm$|mockServiceWorker\.js$/.test(new URL(r.url()).pathname)) heavy.push(r.url());
  });
  await page.goto('./');
  const start = page.getByRole('button', { name: 'Download and start' });
  await expect(start).toBeVisible();
  await expect(page.getByText('Not started').first()).toBeVisible();
  await page.waitForTimeout(1000);
  expect(heavy).toEqual([]);

  await start.click();
  const items = page.getByRole('list', { name: 'Todo list' }).locator(':scope > li');
  await expect(items).toHaveCount(3, { timeout: 60_000 });
  expect(heavy.some((u) => u.endsWith('.wasm'))).toBe(true);

  // The choice is remembered: the next visit starts without the button.
  await page.reload();
  await expect(items).toHaveCount(3, { timeout: 60_000 });
  await expect(start).toHaveCount(0);
});
