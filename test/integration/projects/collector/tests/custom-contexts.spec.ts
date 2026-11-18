// Contexts the package's context override does not see (05-REQ-14, 03-REQ-01).
import { call, lateContextTest, ownPageTest } from './fixtures.ts';

lateContextTest('context overridden after withPerfFixtures', async ({ page }) => {
  await page.goto('/page');
  await call(page, '/api/delay?ms=0&k=late-context');
});

ownPageTest('page on its own context', async ({ page }) => {
  await page.goto('/page');
  await call(page, '/api/delay?ms=0&k=own-page');
});
