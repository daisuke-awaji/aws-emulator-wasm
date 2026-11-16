import { expect, test } from '@playwright/test';

test('AWS SDK v3 round-trips to DynamoDB, S3 and SQS in the browser', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('sdk.html');
  await expect(page.locator('#status')).toHaveText(/^(pass|fail)$/, { timeout: 60_000 });
  const result = await page.evaluate(() => window.__sdkResult);
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(errors).toEqual([]);

  // The virtual clock answers DescribeTable without waiting out the 3-second CREATING span.
  const describe = result.timings.dynamodb.find((t) => t.label === 'DescribeTable');
  expect(describe.ms).toBeLessThan(1000);
  expect(result.skippedMs).toBeGreaterThanOrEqual(2900);

  const lines = [`ready: ${result.readyMs.toFixed(0)} ms`];
  for (const [service, timings] of Object.entries(result.timings)) {
    for (const { label, ms } of timings) lines.push(`${service} ${label}: ${ms} ms`);
  }
  await testInfo.attach('timings', { body: lines.join('\n'), contentType: 'text/plain' });
  console.log(`[${testInfo.project.name}]\n${lines.join('\n')}`);
});
