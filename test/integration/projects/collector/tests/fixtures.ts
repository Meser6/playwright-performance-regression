// The project's test objects (03, chapter 3.1): withPerfFixtures() from the built package.
import { test as base, type Page } from '@playwright/test';
import { withPerfFixtures } from '../../../../../dist/fixture.js';

export const test = withPerfFixtures(base);
export { expect } from '@playwright/test';

export const DEMO_URL = process.env.DEMO_URL ?? '';
export const DEMO_API_URL = process.env.DEMO_API_URL ?? '';

/** Marks the end of the test body, so the integration test can time the teardown. */
export function bodyEnd(): void {
  test.info().annotations.push({ type: 'body-end', description: String(Date.now()) });
}

/** Starts a fetch in the page without waiting for it; resolves when the request was sent. */
export async function startFetch(page: Page, url: string, init?: RequestInit): Promise<void> {
  await Promise.all([
    page.waitForRequest((r) => r.url().endsWith(url)),
    page.evaluate(
      ([u, i]) => {
        void fetch(u, i)
          .then((r) => r.text())
          .catch(() => undefined);
      },
      [url, init ?? {}] as const,
    ),
  ]);
}

/** fetch() in the page and read the body. */
export async function call(page: Page, url: string, init?: RequestInit): Promise<string> {
  return page.evaluate(([u, i]) => fetch(u, i).then((r) => r.text()), [url, init ?? {}] as const);
}

/** A role fixture on its own context (05, chapter 4.1): tracked with perf.track(). */
export const roleTest = test.extend<{ adminPage: Page }>({
  adminPage: async ({ browser, perf }, use) => {
    const context = await browser.newContext({ baseURL: DEMO_URL });
    perf.track(context);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

/** The package fixtures twice in the chain (05-REQ-22). */
export const twiceTest = withPerfFixtures(withPerfFixtures(base));
export const derivedTest = withPerfFixtures(test.extend({}));

/** A user context override after withPerfFixtures() without the base context (03-REQ-01). */
export const lateContextTest = test.extend({
  context: async ({ browser }, use) => {
    const context = await browser.newContext({ baseURL: DEMO_URL });
    await use(context);
    await context.close();
  },
});

/** A user page on its own context, wrapped afterwards (05-REQ-14). */
export const ownPageTest = withPerfFixtures(
  base.extend({
    page: async ({ browser }, use) => {
      const context = await browser.newContext({ baseURL: DEMO_URL });
      const page = await context.newPage();
      await use(page);
      await context.close();
    },
  }),
);
