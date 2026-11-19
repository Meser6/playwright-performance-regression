// One test with REQUESTS (default 20,000) fetch calls in the page, 50 at a time, over 100
// endpoint paths.
import { test as base, expect } from '@playwright/test';
import { withPerfFixtures } from '../../../../../dist/fixture.js';

const test = withPerfFixtures(base);
const REQUESTS = Number(process.env.REQUESTS ?? 20_000);

test('many requests', async ({ page }) => {
  await page.goto('/page');
  const done = await page.evaluate(async (total) => {
    let count = 0;
    for (let start = 0; start < total; start += 50) {
      const batch = [];
      for (let i = start; i < Math.min(total, start + 50); i++) {
        batch.push(fetch(`/api/items/${i % 100}`).then((r) => r.text()));
      }
      await Promise.all(batch);
      count += batch.length;
    }
    return count;
  }, REQUESTS);
  expect(done).toBe(REQUESTS);
});
