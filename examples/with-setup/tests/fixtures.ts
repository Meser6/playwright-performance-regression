import { test as base, type Page } from '@playwright/test';
import { withPerfFixtures } from 'playwright-performance-regression/fixture';

/** A small page object of the shop. */
export class Shop {
  constructor(readonly page: Page) {}

  async open(): Promise<void> {
    // A step of the page object: measured as the step key "open shop" (docs/steps.md).
    await base.step('open shop', async () => {
      await this.page.goto('/app');
      await this.page.locator('#status').waitFor();
    });
  }

  /** Loads the prices from the API origin. */
  prices(apiUrl: string): Promise<unknown> {
    return this.page.evaluate((url) => fetch(`${url}/api/prices`).then((r) => r.json()), apiUrl);
  }
}

// withPerfFixtures() wraps the project's own test object as the last step.
export const test = withPerfFixtures(
  base.extend<{ shop: Shop; apiUrl: string }>({
    apiUrl: process.env.API_URL ?? 'http://localhost:3001',
    shop: async ({ page }, use) => {
      await use(new Shop(page));
    },
  }),
);
export { expect } from '@playwright/test';
