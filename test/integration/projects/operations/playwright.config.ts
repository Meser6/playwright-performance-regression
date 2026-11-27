// Integration project for operation keys (18): real Chromium against the demo server
// (test/demo-server), started by test/integration/operations.test.ts (DEMO_URL).
import { defineConfig } from '@playwright/test';
import { withPerf } from '../../../../dist/config.js';
import perfConfig from './pw-perf.config.ts';

const out = process.env.INTEGRATION_OUT ?? 'out';

export default withPerf(
  defineConfig({
    testDir: 'tests',
    outputDir: `${out}/test-results`,
    timeout: 20_000,
    reporter: [['list'], ['../collector/record-reporter.mjs']],
    use: { baseURL: process.env.DEMO_URL },
    projects: [{ name: 'chromium', testMatch: /.*\.spec\.ts/ }],
  }),
  perfConfig,
);
