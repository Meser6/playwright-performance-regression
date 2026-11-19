import { test as base } from '@playwright/test';

export const test = base.extend<{ a11y: boolean }>({
  a11y: async ({}, use) => {
    await use(true);
  },
});
