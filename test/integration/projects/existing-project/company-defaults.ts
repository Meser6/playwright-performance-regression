import type { PlaywrightTestConfig } from '@playwright/test';

/** Company-wide settings added to every Playwright config (a config wrapper). */
export function withCompanyDefaults(config: PlaywrightTestConfig): PlaywrightTestConfig {
  return { ...config, retries: 2, workers: 2 };
}
