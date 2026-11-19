import { expect, test } from './fixtures';

test('item', async ({ page, api }) => {
  await page.goto('/page');
  expect(await api('/api/items/1')).toContain('items');
});

test('cart', async ({ page, api }) => {
  await page.goto('/page');
  expect(await api('/api/cart')).toContain('cart');
});
