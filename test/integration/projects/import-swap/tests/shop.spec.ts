// Was: import { test, expect } from '@playwright/test';
import { test, expect } from 'playwright-performance-regression/test';

test('the shop page loads its data', async ({ page }) => {
  await page.goto('/app');
  await expect(page.locator('#status')).toHaveText('ready');
});

test('search is measured as a custom measurement', async ({ page, perf }) => {
  await page.goto('/page');
  const hits = await perf.measure('search', () =>
    page.evaluate(() => fetch('/api/search?q=shoes').then((r) => r.json())),
  );
  expect(hits).toEqual({ path: '/api/search' });
});
