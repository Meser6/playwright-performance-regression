import { test as base } from '@playwright/test';
import { withPerfFixtures } from 'playwright-performance-regression/fixture';

export const test = withPerfFixtures(
  base.extend<{ seeded: string }>({
    seeded: async ({}, use) => {
      // A step inside a fixture has the same key as in a test body (06-REQ-20).
      await base.step('seed data', async () => {});
      await use('ok');
    },
  }),
);
export { expect } from '@playwright/test';
