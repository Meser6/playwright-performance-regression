// Integration project "sharding" (17): two test files, so --shard=1/2 and --shard=2/2 each get
// one; both call GET /api/shared.
import { defineConfig } from '@playwright/test';
import { withPerf } from 'playwright-performance-regression/config';

export default withPerf(
  defineConfig({
    testDir: 'tests',
    timeout: 15_000,
    reporter: [['list']],
    use: { baseURL: process.env.BASE_URL },
    projects: [{ name: 'chromium', testMatch: /.*\.spec\.ts/ }],
  }),
);
