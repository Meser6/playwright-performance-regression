// Integration project "import-swap": a fresh Playwright project whose tests import test and
// expect from @playwright/test. The only changes for the package are withPerf() here and the
// import swap to playwright-performance-regression/test in the test files (03-AC-08).
import { defineConfig } from '@playwright/test';
import { withPerf } from 'playwright-performance-regression/config';

export default withPerf(
  defineConfig({
    testDir: 'tests',
    timeout: 20_000,
    reporter: [['list'], ['json', { outputFile: 'results.json' }]],
    use: { baseURL: process.env.BASE_URL },
  }),
);
