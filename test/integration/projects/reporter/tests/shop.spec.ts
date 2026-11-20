// Four tests with a few backend calls each; with FAIL_REPEATS=n the last test fails in its first
// n repetitions (failed test share, 09-REQ-24).
import { call, expect, test } from './fixtures.ts';

for (const id of [1, 2, 3]) {
  test(`item ${id}`, async ({ page }) => {
    await page.goto('/page');
    await call(page, `/api/items/${id}`);
    await call(page, '/api/cart');
  });
}

test('checkout', async ({ page }) => {
  await page.goto('/page');
  await call(page, '/api/orders');
  const failing = Number(process.env.FAIL_REPEATS ?? 0);
  expect(test.info().repeatEachIndex >= failing, 'failure requested by FAIL_REPEATS').toBe(true);
});
