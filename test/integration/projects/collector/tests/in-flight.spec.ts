// A request still in flight when the test body ends (05-AC-06).
import { bodyEnd, startFetch, test } from './fixtures.ts';

test('request in flight at test end', async ({ page }) => {
  await page.goto('/page');
  await startFetch(page, '/api/delay?ms=3000&k=in-flight');
  bodyEnd();
});
