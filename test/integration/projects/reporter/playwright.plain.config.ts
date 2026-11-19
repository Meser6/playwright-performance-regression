// The reporter project without withPerf() (01-REQ-07): in perf mode no package reporter runs, so
// the CLI finds no outcome file (04-REQ-23).
import { defineConfig } from '@playwright/test';

const out = process.env.INTEGRATION_OUT ?? 'out';

export default defineConfig({
  testDir: 'tests',
  outputDir: `${out}/test-results`,
  timeout: 20_000,
  reporter: [['list']],
  use: { baseURL: process.env.DEMO_URL },
  projects: [{ name: 'chromium', testMatch: /.*\.spec\.ts/ }],
});
