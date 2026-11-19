import { expect, test } from 'playwright-performance-regression/test';

test('the shop page loads its data', async ({ page }) => {
  await page.goto('/app');
  await expect(page.locator('#status')).toHaveText('ready');
});
