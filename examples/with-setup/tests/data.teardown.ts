import { test as teardown } from '@playwright/test';

teardown('remove test data', async ({ request }) => {
  await request.delete('/api/test-data');
});
