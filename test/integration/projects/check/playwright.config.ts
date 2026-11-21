// Integration project "check" (04, chapter 4.11): a setup project and 3 files with 4 tests each.
import { defineConfig } from '@playwright/test';
import { withPerf } from 'playwright-performance-regression/config';

export default withPerf(
  defineConfig({
    testDir: 'tests',
    timeout: 15_000,
    reporter: [['list']],
    use: { baseURL: process.env.BASE_URL },
    projects: [
      { name: 'setup', testMatch: /.*\.setup\.ts/ },
      { name: 'chromium', testMatch: /.*\.spec\.ts/, dependencies: ['setup'] },
    ],
  }),
);
