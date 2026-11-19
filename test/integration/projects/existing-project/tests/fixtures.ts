// Several test objects, as in many existing projects.
import { test as base, mergeTests, type Page } from '@playwright/test';
import { withPerfFixtures } from 'playwright-performance-regression/fixture';

/** fetch() in the page and read the body. */
export function call(page: Page, path: string): Promise<unknown> {
  return page.evaluate((url) => fetch(url).then((r) => r.json()), path);
}

// The main test object with own fixtures: wrapped as the last step of the chain.
export const test = withPerfFixtures(
  base.extend<{ shop: Page }>({
    shop: async ({ page }, use) => {
      await page.goto('/page');
      await use(page);
    },
  }),
);
export { expect } from '@playwright/test';

// Derived from the wrapped object: already measured.
export const adminTest = test.extend<{ admin: Page }>({
  admin: async ({ shop }, use) => {
    await call(shop, '/api/ep/admin-login');
    await use(shop);
  },
});

// Two fixture sets merged: the merged object is wrapped.
const a11yTest = base.extend<{ audit: () => Promise<void> }>({
  audit: async ({ page }, use) => use(async () => void (await page.title())),
});
const dataTest = base.extend<{ seed: () => Promise<unknown> }>({
  seed: async ({ page }, use) => use(() => call(page, '/api/ep/seed')),
});
export const mergedTest = withPerfFixtures(mergeTests(a11yTest, dataTest));

// API-only tests with the request fixture: not wrapped (nothing to measure in the browser).
export const apiTest = base;
