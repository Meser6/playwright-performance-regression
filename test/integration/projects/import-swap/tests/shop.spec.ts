// Was: import { test, expect } from '@playwright/test';
import { test, expect } from 'playwright-performance-regression/test';

test('the shop page loads its data', async ({ page }) => {
  await page.goto('/app');
  await expect(page.locator('#status')).toHaveText('ready');
});

test('search uses the perf fixture of the package', async ({ page, perf }) => {
  expect(typeof perf.track).toBe('function');
  await page.goto('/page');
  const hits = await page.evaluate(() => fetch('/api/search?q=shoes').then((r) => r.json()));
  expect(hits).toEqual({ path: '/api/search' });
});
