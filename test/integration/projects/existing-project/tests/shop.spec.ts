import { adminTest, apiTest, call, expect, mergedTest, test } from './fixtures.ts';

test('orders page', async ({ shop }) => {
  expect(await call(shop, '/api/ep/orders')).toEqual({ path: '/api/ep/orders' });
});

test('recommendations come from a mock', async ({ shop }) => {
  await shop.route('**/api/ep/recommendations', (route) => route.fulfill({ json: { items: [] } }));
  expect(await call(shop, '/api/ep/recommendations')).toEqual({ items: [] });
});

test('sometimes fails on the first attempt', async ({ shop }, testInfo) => {
  await call(shop, '/api/ep/flaky');
  // Fails on the first attempt of the first execution only: with retries it is "flaky".
  expect(testInfo.retry + testInfo.repeatEachIndex).toBeGreaterThan(0);
});

adminTest('admin dashboard', async ({ admin }) => {
  await call(admin, '/api/ep/admin-dashboard');
});

mergedTest('merged fixtures', async ({ page, audit, seed }) => {
  await page.goto('/page');
  await seed();
  await audit();
});

apiTest('health endpoint', async ({ request }) => {
  expect((await request.get('/api/ep/health')).ok()).toBe(true);
});
