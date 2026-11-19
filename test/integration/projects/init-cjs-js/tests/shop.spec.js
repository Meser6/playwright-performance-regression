const { expect, test } = require('./fixtures');

test('item', async ({ page, api }) => {
  await page.goto('/page');
  expect(await api('/api/items/1')).toContain('items');
});
