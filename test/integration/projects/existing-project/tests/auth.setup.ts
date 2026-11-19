import { test } from '@playwright/test';

test('log in', async ({ request }) => {
  await request.post('/api/ep/login');
});
