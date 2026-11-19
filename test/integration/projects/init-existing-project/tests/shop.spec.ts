import { adminTest, test } from './fixtures';

test('shop @perf', async ({ page }) => {
  await page.goto('/');
});

adminTest('admin', async ({ page }) => {
  await page.goto('/admin');
});
