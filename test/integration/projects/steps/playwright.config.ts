// Integration project "steps" (06, chapter 11): test.step timings with nested steps, steps in
// hooks and fixtures, box, skip, a caught step error, a step that times out the test, a setup
// project and step titles with personal data and secrets.
import { defineConfig } from '@playwright/test';
import { withPerf } from 'playwright-performance-regression/config';
import perfConfig from './pw-perf.config.ts';

export default withPerf(
  defineConfig({
    testDir: 'tests',
    timeout: 10_000,
    reporter: [['list']],
    use: { baseURL: process.env.BASE_URL },
    projects: [
      { name: 'setup', testMatch: /.*\.setup\.ts/ },
      { name: 'chromium', testMatch: /.*\.spec\.ts/, dependencies: ['setup'] },
    ],
  }),
  perfConfig,
);
