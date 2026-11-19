import { defineConfig } from '@playwright/test';
import { withPerf } from 'playwright-performance-regression/config';

// The demo app of this repository; started by Playwright unless BASE_URL points elsewhere.
const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

export default withPerf(
  defineConfig({
    testDir: 'tests',
    use: { baseURL },
    webServer: process.env.BASE_URL
      ? undefined
      : {
          command: 'node ../../test/demo-server/server.ts',
          env: { PORT: '3000', API_PORT: '3001' },
          url: `${baseURL}/page`,
          reuseExistingServer: true,
        },
  }),
);
