// Retries set in a test file win over the perf-mode config (04-REQ-19, 04-AC-16).
import { call, expect, test } from './fixtures.ts';

test.describe.configure({ retries: 2 });

test('passes on retry', async ({ page }) => {
  await page.goto('/page');
  await call(page, '/api/cart');
  expect(test.info().retry).toBeGreaterThan(0);
});
