// The end-of-test wait stays inside the teardown time slot (05-REQ-27, 05-AC-12).
import { bodyEnd, startFetch, test } from './fixtures.ts';

test('budget without hooks', async ({ page }) => {
  test.setTimeout(2000);
  await page.goto('/page');
  await startFetch(page, '/api/delay?ms=5000&k=budget');
  await page.waitForTimeout(1500);
  bodyEnd();
});

test.describe('with afterEach', () => {
  test.afterEach(async () => {
    await new Promise((r) => setTimeout(r, 500));
  });

  test('budget with afterEach', async ({ page }) => {
    test.setTimeout(2000);
    await page.goto('/page');
    await startFetch(page, '/api/delay?ms=5000&k=budget-hook');
    await page.waitForTimeout(1500);
    bodyEnd();
  });
});
