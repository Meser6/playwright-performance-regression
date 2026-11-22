// APIRequestContext calls (15). The assertions on the samples are in
// test/integration/collector.test.ts; the tests here only make the calls.
import { DEMO_API_URL, DEMO_URL, expect, test } from './fixtures.ts';

/** Whether the methods of the request fixture are wrapped (15-AC-04), for the assertions. */
function markWrapped(target: object): void {
  test
    .info()
    .annotations.push({ type: 'wrapped', description: String(Object.hasOwn(target, 'get')) });
}

test('api request fixture', async ({ request }) => {
  markWrapped(request);
  const response = await request.get('/api/delay?ms=200');
  expect(response.status()).toBe(200);
  await Promise.all([request.post('/api/orders', { data: { id: 1 } }), request.fetch('/api/cart')]);
});

test('api page and context request', async ({ page, context }) => {
  await page.goto('/page');
  await page.request.post('/api/orders', { data: { id: 2 } });
  await context.request.get('/api/delay?ms=10');
});

test('api tracked context', async ({ playwright, perf }) => {
  const own = await playwright.request.newContext({ baseURL: DEMO_URL });
  perf.trackRequestContext(own);
  perf.trackRequestContext({} as never);
  await own.get('/api/delay?ms=20');
  await own.dispose();
});

test('api context with its own baseURL', async ({ browser, perf }) => {
  const own = await browser.newContext({ baseURL: DEMO_API_URL });
  perf.track(own);
  await own.request.get('/api/delay?ms=5');
  await own.close();
});

test('api call that throws', async ({ request }) => {
  await expect(request.get('/api/hang', { timeout: 300 })).rejects.toThrow(
    /Timeout 300ms exceeded/,
  );
});
