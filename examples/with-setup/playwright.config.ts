import { defineConfig } from '@playwright/test';
import { withPerf } from 'playwright-performance-regression/config';
import perfConfig from './pw-perf.config.ts';

// The demo app of this repository; started by Playwright unless BASE_URL points elsewhere.
const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

export default withPerf(
  defineConfig({
    testDir: 'tests',
    use: { baseURL },
    projects: [
      // Logs in once and saves the session; runs once, is not measured.
      { name: 'setup', testMatch: /.*\.setup\.ts/, teardown: 'cleanup' },
      { name: 'cleanup', testMatch: /.*\.teardown\.ts/ },
      {
        name: 'chromium',
        testMatch: /.*\.spec\.ts/,
        dependencies: ['setup'],
        use: { storageState: '.auth/user.json' },
      },
    ],
    webServer: process.env.BASE_URL
      ? undefined
      : {
          command: 'node ../../test/demo-server/server.ts',
          env: { PORT: '3000', API_PORT: '3001' },
          url: `${baseURL}/page`,
          reuseExistingServer: true,
        },
  }),
  perfConfig,
);
