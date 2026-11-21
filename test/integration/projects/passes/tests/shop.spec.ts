// Two tests; `--grep cart` selects one of them.
import { expect, test } from 'playwright-performance-regression/test';

test('cart', async ({ page }) => {
  await page.goto('/page');
  const status = await page.evaluate(() => fetch('/api/cart').then((r) => r.status));
  expect(status).toBe(200);
});

test('items', async ({ page }) => {
  await page.goto('/page');
  await page.evaluate(() => fetch('/api/items/1').then((r) => r.status));
});
