import { test } from '@playwright/test';

for (const n of [1, 2]) {
  test(`setup ${n}`, async () => {});
}
