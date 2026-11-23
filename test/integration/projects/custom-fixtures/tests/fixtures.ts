// The project's test objects. withPerfFixtures() wraps the most extended test object; fixtures
// that need `perf` are added after it.
import { test as base, type BrowserContext, type Page } from '@playwright/test';
import { trackContext, withPerfFixtures } from 'playwright-performance-regression/fixture';

/** fetch() in the page and read the body. */
export function call(page: Page, path: string): Promise<unknown> {
  return page.evaluate((url) => fetch(url).then((r) => r.json()), path);
}

// Own fixtures, including a context override that builds on the base context.
const withApp = base.extend<{ shop: Page }>({
  context: async ({ context }, use) => {
    await context.setExtraHTTPHeaders({ 'x-tenant': 'demo' });
    await use(context);
  },
  shop: async ({ page }, use) => {
    await page.goto('/page');
    await use(page);
  },
});

export const test = withPerfFixtures(withApp);
export { expect } from '@playwright/test';

// A page fixture on its own context, created with browser.newContext().
export const ownPageTest = withPerfFixtures(
  base.extend({
    page: async ({ browser, baseURL }, use) => {
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      await use(page);
      await context.close();
    },
  }),
);

// Not recommended, but supported: a context override after withPerfFixtures() that ignores
// the base context. The package's page override still tracks the page's context.
export const lateTest = test.extend({
  context: async ({ browser, baseURL }, use) => {
    const context = await browser.newContext({ baseURL });
    await use(context);
    await context.close();
  },
});

// Role pages on their own contexts, tracked with perf.track().
export const rolesTest = test.extend<{ adminPage: Page; userPage: Page }>({
  adminPage: async ({ browser, baseURL, perf }, use) => {
    const context = await browser.newContext({ baseURL });
    perf.track(context);
    const page = await context.newPage();
    await page.goto('/page');
    await use(page);
    await context.close();
  },
  userPage: async ({ browser, baseURL, perf }, use) => {
    const context = await browser.newContext({ baseURL });
    perf.track(context);
    const page = await context.newPage();
    await page.goto('/page');
    await use(page);
    await context.close();
  },
});

// A logged-in context shared by the tests of a worker, registered with trackContext().
export const accountTest = test.extend<object, { account: BrowserContext }>({
  account: [
    async ({ browser }, use) => {
      const context = await browser.newContext({ baseURL: process.env.BASE_URL });
      trackContext(context);
      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],
});

// Two exported test objects in one chain, both wrapped (F2): the second extends the first. The
// fixtures of the outer wrapper override the inner ones, so every request is recorded once.
export const testNoAuth = withPerfFixtures(base);
export const chainTest = withPerfFixtures(
  testNoAuth.extend({
    request: async ({ request }, use) => {
      await use(request);
    },
  }),
);
