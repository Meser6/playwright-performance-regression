import {
  accountTest,
  call,
  chainTest,
  expect,
  lateTest,
  ownPageTest,
  rolesTest,
  test,
  testNoAuth,
} from './fixtures.ts';

test('own fixture on the overridden base context', async ({ shop }) => {
  expect(await call(shop, '/api/cf/base-context')).toEqual({ path: '/api/cf/base-context' });
});

ownPageTest('page fixture on its own context', async ({ page }) => {
  await page.goto('/page');
  await call(page, '/api/cf/own-page');
});

lateTest('context override after the wrapper', async ({ page }) => {
  await page.goto('/page');
  await call(page, '/api/cf/late-page');
});

test('context created in the test', async ({ browser, baseURL, perf }) => {
  const tracked = await browser.newContext({ baseURL });
  perf.track(tracked);
  const untracked = await browser.newContext({ baseURL });
  for (const [context, path] of [
    [tracked, '/api/cf/tracked'],
    [untracked, '/api/cf/untracked'],
  ] as const) {
    const page = await context.newPage();
    await page.goto('/page');
    await call(page, path);
  }
  await untracked.close();
  await tracked.close();
});

rolesTest('admin and user pages', async ({ adminPage, userPage }) => {
  await call(adminPage, '/api/cf/admin');
  await call(userPage, '/api/cf/user');
});

accountTest.describe('worker-scoped account', () => {
  for (const name of ['first', 'second']) {
    accountTest(`account page ${name}`, async ({ account }) => {
      const page = await account.newPage();
      await page.goto('/page');
      await call(page, `/api/cf/account-${name}`);
      await page.close();
    });
  }
});

testNoAuth('inner test object of a wrapped chain', async ({ page }) => {
  await page.goto('/page');
  await call(page, '/api/cf/chain-inner');
});

chainTest('outer test object of a wrapped chain', async ({ page, request }) => {
  await page.goto('/page');
  await call(page, '/api/cf/chain-page');
  expect((await request.get('/api/cf/chain-request')).ok()).toBe(true);
});
