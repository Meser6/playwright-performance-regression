import { test } from './fixtures.ts';

for (const n of [1, 2, 3]) {
  test('a test ' + String(n), async ({ page }) => {
    await page.goto('/page');
    await page.evaluate(async () => {
      await fetch('/api/a').then((r) => r.text());
      await fetch('/api/shared').then((r) => r.text());
    });
  });
}
