// Integration project for the collector (05, 06): real Chromium against the demo server
// (test/demo-server), started by test/integration/collector.test.ts (DEMO_URL, DEMO_API_URL).
import { defineConfig } from '@playwright/test';
import { withPerf } from '../../../../dist/config.js';
import perfConfig from './pw-perf.config.ts';

const out = process.env.INTEGRATION_OUT ?? 'out';

export default withPerf(
  defineConfig({
    testDir: 'tests',
    outputDir: `${out}/test-results`,
    timeout: 20_000,
    reporter: [['list'], ['./record-reporter.mjs']],
    use: { baseURL: process.env.DEMO_URL, trace: 'off' },
    projects: [
      { name: 'setup', testMatch: /.*\.setup\.ts/ },
      { name: 'chromium', testMatch: /.*\.spec\.ts/, dependencies: ['setup'] },
    ],
  }),
  perfConfig,
);
