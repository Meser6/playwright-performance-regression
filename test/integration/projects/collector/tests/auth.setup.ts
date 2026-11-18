// Setup project: a dependency of the measured project, not measured itself (05-REQ-21).
import { call, test } from './fixtures.ts';

test('setup logs in', async ({ page }) => {
  await page.goto('/page');
  await call(page, '/api/login');
});
