import { expect, test } from 'playwright-performance-regression/test';

// An API test: calls of the request fixture are measured too, as keys like
// "request GET /api/products" next to the browser's "GET /api/products".
test('products API', async ({ request }) => {
  const response = await request.get('/api/products');
  expect(response.ok()).toBe(true);
});
