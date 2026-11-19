// Performance project "many-requests" (12-PERF-04, V-04): one test that makes REQUESTS backend
// calls against the demo server (DEMO_URL). The probe reporter runs before the package reporter
// and records when onTestEnd starts and when the run ends.
import { defineConfig } from '@playwright/test';
import { withPerf } from '../../../../dist/config.js';
import perfConfig from './pw-perf.config.ts';

const out = process.env.INTEGRATION_OUT ?? 'out';

export default withPerf(
  defineConfig({
    testDir: 'tests',
    outputDir: `${out}/test-results`,
    timeout: 600_000,
    reporter: [['list'], ['./probe-reporter.mjs']],
    use: { baseURL: process.env.DEMO_URL },
    projects: [{ name: 'chromium' }],
  }),
  perfConfig,
);
