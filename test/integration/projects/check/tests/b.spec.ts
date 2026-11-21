import { expect, test } from './fixtures.ts';

for (const n of [1, 2, 3, 4]) {
  test('b test ' + String(n), async ({ page }) => {
    await page.goto('/page');
    await page.evaluate(() =>
      fetch('/api/items/' + String(Math.random() > 2 ? 0 : 7)).then((r) => r.text()),
    );
    // CHECK_FAIL_FIRST=1: the first test of file a fails (04-AC-34).
    expect(process.env.CHECK_FAIL_FIRST === '1' && 'b' === 'a' && n === 1).toBe(false);
  });
}
