import { test } from '@playwright/test';

test('log in', async () => {
  // Steps of a setup project are not measured (06-REQ-19).
  await test.step('login in setup', async () => {});
});
