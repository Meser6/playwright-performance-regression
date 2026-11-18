import { test, expect } from '../../_shared/fixtures.mjs';

test('uses page', async ({ page }) => {
  await page.goto('/page');
  const json = await page.evaluate(() => fetch('/api/delay?ms=50').then((r) => r.json()));
  expect(json.ok).toBe(true);
});

test('no browser', async () => {
  expect(1 + 1).toBe(2);
});
