import { defineConfig } from '@playwright/test';
import { withPerf } from '../_shared/with-perf.cjs';

export default withPerf(
  defineConfig({
    testDir: 'tests',
    reporter: [['list'], ['../_shared/reporter.mjs']],
    use: { baseURL: process.env.PROTO_BASE },
    projects: [
      { name: 'chromium', use: { browserName: 'chromium' } },
      { name: 'firefox', use: { browserName: 'firefox' } },
      { name: 'webkit', use: { browserName: 'webkit' } },
    ],
  }),
  { marker: 'browsers' },
);
