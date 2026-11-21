// Integration project "passes" (D-39, 04 chapter 4.12): the test script has a setup step, and the
// run has run.passes.test passes.
import { defineConfig } from '@playwright/test';
import { withPerf } from 'playwright-performance-regression/config';

export default withPerf(
  defineConfig({
    testDir: 'tests',
    timeout: 15_000,
    reporter: [['list']],
    use: { baseURL: process.env.BASE_URL },
    projects: [{ name: 'chromium' }],
  }),
  { run: { passes: { test: 3 } } },
);
