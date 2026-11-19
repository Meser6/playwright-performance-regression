// Integration project for the reporter (01, chapter 4.6): real Chromium against the demo server
// (test/demo-server), started by test/integration/reporter.test.ts (DEMO_URL).
import { defineConfig } from '@playwright/test';
import { withPerf } from '../../../../dist/config.js';
import perfConfig from './pw-perf.config.ts';

const out = process.env.INTEGRATION_OUT ?? 'out';

export default withPerf(
  defineConfig({
    testDir: 'tests',
    outputDir: `${out}/test-results`,
    timeout: 20_000,
    reporter: [['list']],
    use: { baseURL: process.env.DEMO_URL },
    projects: [
      {
        name: 'chromium',
        testMatch: process.env.INTEGRATION_RETRIES ? /retries\.flaky\.ts/ : /.*\.spec\.ts/,
      },
    ],
  }),
  perfConfig,
);
