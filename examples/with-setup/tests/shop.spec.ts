import { expect, test } from './fixtures.ts';

test('the shop loads', { tag: '@perf' }, async ({ shop }) => {
  await shop.open();
  await expect(shop.page.locator('#status')).toHaveText('ready');
});

test('prices come from the API', { tag: '@perf' }, async ({ shop, apiUrl }) => {
  await shop.open();
  expect(await shop.prices(apiUrl)).toEqual({ path: '/api/prices' });
});

test('loading the cart is measured as a whole', { tag: '@perf' }, async ({ shop, perf }) => {
  await shop.page.goto('/page');
  // A custom measurement: one user-visible step that may make several requests.
  await perf.measure('checkout:load-cart', async () => {
    await shop.page.evaluate(() =>
      Promise.all(['/api/cart', '/api/cart/items'].map((u) => fetch(u).then((r) => r.json()))),
    );
  });
});

test('profile page (not measured: not tagged)', async ({ shop }) => {
  await shop.page.goto('/page');
  await shop.page.evaluate(() => fetch('/api/profile').then((r) => r.json()));
});
