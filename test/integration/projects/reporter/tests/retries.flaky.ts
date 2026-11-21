// Retries of the Playwright config stay in perf mode and every attempt is measured (D-38,
// 04-AC-16): the first attempt fails, the retry passes.
import { call, expect, test } from './fixtures.ts';

test('passes on retry', async ({ page }) => {
  await page.goto('/page');
  await call(page, '/api/cart');
  expect(test.info().retry).toBeGreaterThan(0);
});
