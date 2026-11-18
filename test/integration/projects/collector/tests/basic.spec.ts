// Collector and custom measurements in one browser (05, 06). The assertions on the samples are
// in test/integration/collector.test.ts; the tests here only drive the browser.
import {
  DEMO_API_URL,
  DEMO_URL,
  bodyEnd,
  call,
  derivedTest,
  expect,
  roleTest,
  startFetch,
  test,
  twiceTest,
} from './fixtures.ts';

test('no browser', async ({ perf }) => {
  expect(await perf.measure('compute', () => 21 * 2)).toBe(42);
});

test('popup and second tab', async ({ page, context }) => {
  await page.goto('/page');
  const popupCall = context.waitForEvent('requestfinished', (r) => r.url().endsWith('/api/popup'));
  await page.evaluate(() => {
    window.open('/popup');
  });
  await popupCall;
  const tab = await context.newPage();
  const tabCall = context.waitForEvent('requestfinished', (r) => r.url().endsWith('/api/tab'));
  await tab.goto('/tab');
  await tabCall;
});

test('redirect', async ({ page }) => {
  await page.goto('/page');
  await call(page, '/api/redirect?to=/api/delay?ms=50');
});

test('service worker', async ({ page }) => {
  await page.goto('/sw-page');
  await page.evaluate(() => (window as unknown as { swReady: Promise<boolean> }).swReady);
  expect(await call(page, '/api/sw-cached')).toContain('service-worker');
});

test('errors and aborts', async ({ page }) => {
  await page.goto('/page');
  await page.route(/k=aborted/, (route) => route.abort());
  await call(page, '/api/delay?ms=0&k=aborted').catch(() => undefined);
  await call(page, '/api/drop').catch(() => undefined);
  await call(page, '/api/status?code=500');
  await call(page, '/api/data.json');
  await call(page, '/static/app.js');
});

test('cors preflight', async ({ page }) => {
  await page.goto('/page');
  await call(page, `${DEMO_API_URL}/api/delay?ms=100&preflightMs=300&k=preflight`, {
    headers: { 'x-custom': '1' },
  });
});

test('unread body', async ({ page }) => {
  await page.goto('/page');
  const response = page.waitForResponse(/k=unread/);
  await page.evaluate(() => {
    // The page never reads the body of this response.
    void fetch('/api/delay?ms=0&k=unread');
  });
  await response;
  bodyEnd();
});

test('closed page', async ({ page, context }) => {
  await page.goto('/page');
  const second = await context.newPage();
  await second.goto('/page');
  await startFetch(second, '/api/delay?ms=2000&k=page-close');
  await second.close();
  bodyEnd();
});

test('closed context', async ({ browser, perf }) => {
  const own = await browser.newContext({ baseURL: DEMO_URL });
  perf.track(own);
  const page = await own.newPage();
  await page.goto('/page');
  await startFetch(page, '/api/delay?ms=2000&k=context-close');
  await own.close();
  bodyEnd();
});

test('tracked and untracked contexts', async ({ browser, perf }) => {
  const tracked = await browser.newContext({ baseURL: DEMO_URL });
  perf.track(tracked);
  perf.track(tracked);
  const untracked = await browser.newContext({ baseURL: DEMO_URL });
  for (const [context, k] of [
    [tracked, 'tracked'],
    [untracked, 'untracked'],
  ] as const) {
    const page = await context.newPage();
    await page.goto('/page');
    await call(page, `/api/delay?ms=0&k=${k}`);
  }
  await tracked.close();
  await untracked.close();
});

roleTest('role fixture closes its context', async ({ adminPage }) => {
  await adminPage.goto('/page');
  await startFetch(adminPage, '/api/delay?ms=3000&k=role-close');
  bodyEnd();
});

test('single wrap', async ({ page }) => {
  await page.goto('/page');
  await call(page, '/api/delay?ms=0&k=wrap');
});

twiceTest('twice wrapped', async ({ page }) => {
  await page.goto('/page');
  await call(page, '/api/delay?ms=0&k=wrap');
});

derivedTest('derived and wrapped again', async ({ page }) => {
  await page.goto('/page');
  await call(page, '/api/delay?ms=0&k=wrap');
});

test.describe('custom measurements', () => {
  test.beforeEach(async ({ perf }) => {
    await perf.measure('hook:before-each', () => new Promise((r) => setTimeout(r, 20)));
  });

  test('measure, start and end', async ({ page, perf }) => {
    const title = await perf.measure('demo:load', async () => {
      await page.goto('/page');
      return page.title();
    });
    expect(title).toBe('demo');
    perf.start('demo:call');
    await call(page, '/api/delay?ms=100');
    const duration = perf.end('demo:call');
    expect(duration).toBeGreaterThanOrEqual(100);
    perf.sampleStart('demo:alias');
    expect(typeof perf.sampleEnd('demo:alias')).toBe('number');
    const error = new Error('step failed');
    await expect(perf.measure('demo:error', () => Promise.reject(error))).rejects.toBe(error);
    expect(() => perf.start(' bad')).toThrow(TypeError);
  });

  test('timeout during measure', async ({ perf }) => {
    test.info().expectedStatus = 'timedOut';
    test.setTimeout(500);
    await perf.measure('demo:slow', () => new Promise((r) => setTimeout(r, 3000)));
  });
});
