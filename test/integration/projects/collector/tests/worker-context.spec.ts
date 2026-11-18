// A context shared by the tests of a worker, registered with trackContext() (05-REQ-23).
import type { Page } from '@playwright/test';
import { trackContext } from '../../../../../dist/fixture.js';
import { DEMO_URL, call, startFetch, test } from './fixtures.ts';

const workerTest = test.extend<object, { workerPage: Page }>({
  workerPage: [
    async ({ browser }, use) => {
      const context = await browser.newContext({ baseURL: DEMO_URL });
      trackContext(context);
      const page = await context.newPage();
      await page.goto('/page');
      await use(page);
      await context.close();
    },
    { scope: 'worker' },
  ],
});

workerTest('worker context first', async ({ workerPage }) => {
  await call(workerPage, '/api/delay?ms=0&k=first');
  // Still in flight at the end of this test and of its wait: finishes during the next test.
  await startFetch(workerPage, '/api/delay?ms=3000&k=straddle');
});

workerTest('worker context second', async ({ workerPage }) => {
  const straddle = workerPage.waitForEvent('requestfinished', (r) =>
    r.url().includes('k=straddle'),
  );
  await call(workerPage, '/api/delay?ms=0&k=second');
  await straddle;
});
