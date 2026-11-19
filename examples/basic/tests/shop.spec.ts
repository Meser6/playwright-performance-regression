import { expect, test } from 'playwright-performance-regression/test';

test('the shop page loads its data', async ({ page }) => {
  await page.goto('/app');
  await expect(page.locator('#status')).toHaveText('ready');
});

test('search', async ({ page }) => {
  await page.goto('/page');
  const result = await page.evaluate(() =>
    fetch('/api/search?q=shoes&page=1').then((r) => r.json()),
  );
  expect(result).toEqual({ path: '/api/search' });
});
