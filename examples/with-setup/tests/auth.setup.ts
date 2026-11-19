import { test as setup } from '@playwright/test';

setup('log in', async ({ page }) => {
  await page.goto('/page');
  await page.evaluate(() => fetch('/api/login', { method: 'POST' }));
  await page.context().addCookies([{ name: 'session', value: 'demo', url: page.url() }]);
  await page.context().storageState({ path: '.auth/user.json' });
});
