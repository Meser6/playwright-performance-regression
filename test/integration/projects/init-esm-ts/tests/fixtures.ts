import { test as base } from '@playwright/test';

export const test = base.extend<{ api: (path: string) => Promise<string> }>({
  api: async ({ page }, use) => {
    await use((path) => page.evaluate((p) => fetch(p).then((r) => r.text()), path));
  },
});
export { expect } from '@playwright/test';
