import { test, expect } from '@playwright/test';

test('item @perf', async ({ page }) => {
  await page.goto('/page');
  expect(await page.evaluate(() => fetch('/api/items/1').then((r) => r.text()))).toContain('1');
});

test('cart', { tag: '@perf' }, async ({ page }) => {
  await page.goto('/page');
  await page.evaluate(() => fetch('/api/cart').then((r) => r.text()));
});
