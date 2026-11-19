import type { PlaywrightTestConfig } from '@playwright/test';

/** Company-wide settings added to every Playwright config. */
export function withCompanyDefaults(config: PlaywrightTestConfig): PlaywrightTestConfig {
  return { ...config, retries: 2, reporter: [['list'], ['junit', { outputFile: 'junit.xml' }]] };
}
