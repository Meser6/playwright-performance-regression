// Integration project "multi-browser": Chromium, Firefox and WebKit projects with the same
// tests. By default perf mode measures Chromium only and removes the other projects from the
// run; PERF_PROJECTS=firefox measures Firefox instead (best effort).
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
