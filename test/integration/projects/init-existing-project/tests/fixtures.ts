import { test as base, mergeTests } from '@playwright/test';
import { test as a11yTest } from './a11y';

export const test = base.extend<{ user: string }>({
  user: async ({}, use) => {
    await use('user');
  },
});

export const adminTest = test.extend<{ admin: string }>({
  admin: async ({}, use) => {
    await use('admin');
  },
});

export const fullTest = mergeTests(test, a11yTest);
