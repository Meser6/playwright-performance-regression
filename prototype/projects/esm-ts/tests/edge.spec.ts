import { test, expect } from '../../_shared/fixtures.mjs';

// Only run when a check asks for them, so the default run stays green.
test('fails on purpose', async ({ page }) => {
  test.skip(process.env.PROTO_EDGE !== '1');
  await page.goto('/page');
  expect(1).toBe(2);
});

test('times out on purpose', async ({ page }) => {
  test.skip(process.env.PROTO_EDGE !== '1');
  test.setTimeout(1000);
  await page.goto('/page');
  await page.waitForTimeout(3000);
});
