// The project's test object (03, chapter 3.1): withPerfFixtures() from the built package.
import { test as base, type Page } from '@playwright/test';
import { withPerfFixtures } from '../../../../../dist/fixture.js';

export const test = withPerfFixtures(base);
export { expect } from '@playwright/test';

/** fetch() in the page and read the body. */
export async function call(page: Page, url: string): Promise<string> {
  return page.evaluate((u) => fetch(u).then((r) => r.text()), url);
}
