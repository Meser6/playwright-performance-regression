// Integration project "multi-browser": Chromium, Firefox and WebKit projects with the same
// tests. Perf mode measures the projects the test command selects: --project chromium, or
// --project firefox (best effort, 04-REQ-18).
import { defineConfig, devices } from '@playwright/test';
import { withPerf } from 'playwright-performance-regression/config';
import perfConfig from './pw-perf.config.ts';

export default withPerf(
  defineConfig({
    testDir: 'tests',
    timeout: 20_000,
    reporter: [['list'], ['json', { outputFile: 'results.json' }]],
    use: { baseURL: process.env.BASE_URL },
    projects: [
      { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
      { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
      { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ],
  }),
  perfConfig,
);
