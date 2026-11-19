import { expect, test, type Page } from '@playwright/test';

async function open(page: Page): Promise<void> {
  await page.goto('/page');
}

test('home', async ({ page }) => {
  await open(page);
  await expect(page).toHaveTitle(/demo/);
});
