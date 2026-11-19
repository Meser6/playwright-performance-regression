// Input of the init wizard tests (04-AC-17): tests import test from @playwright/test (D-14),
// a setup project, tests tagged @perf, Azure Pipelines.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 20_000,
  use: { baseURL: process.env.DEMO_URL },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    { name: 'chromium', testMatch: /.*\.spec\.ts/, dependencies: ['setup'] },
  ],
});
