import { test as base, createBdd } from 'playwright-bdd';
import { withPerfFixtures } from 'playwright-performance-regression/fixture';

// playwright-bdd's test object, wrapped before it is passed to createBdd(); the generated tests import it from here.
export const test = withPerfFixtures(base);
const { Given, When, Then } = createBdd(test);

let catalog: unknown;

Given('I open the shop', async ({ page }) => {
  await page.goto('/page');
});

When('I load the catalog', async ({ page }) => {
  catalog = await page.evaluate(() => fetch('/api/ep/catalog').then((r) => r.json()));
});

Then('the catalog is shown', () => {
  if (catalog === undefined) throw new Error('no catalog');
});
