// Integration project: ESM, TypeScript config, package config in pw-perf.config.ts (03, 3.1).
// The package is imported from its ESM build in dist/.
import { defineConfig } from '@playwright/test';
import { withPerf } from '../../../../dist/config.js';
import perfConfig from './pw-perf.config.ts';

const out = process.env.INTEGRATION_OUT ?? 'out';

const base = defineConfig({
  testDir: 'tests',
  outputDir: `${out}/test-results`,
  workers: 2,
  retries: 1,
  use: { trace: 'on' },
  reporter: [
    ['list'],
    ['junit', { outputFile: `${out}/junit.xml` }],
    ['html', { outputFolder: `${out}/html`, open: 'never' }],
    ['./record-reporter.mjs'],
  ],
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/, teardown: 'cleanup' },
    { name: 'cleanup', testMatch: /.*\.teardown\.ts/ },
    { name: 'chromium', testMatch: /.*\.spec\.ts/, dependencies: ['setup'] },
    {
      name: 'firefox',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { browserName: 'firefox' },
    },
    {
      name: 'webkit',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { browserName: 'webkit' },
    },
  ],
});

const config = withPerf(base, perfConfig);
// Read by record-reporter.mjs in the main process.
(globalThis as Record<string, unknown>).integrationSameObject = config === base;
export default config;
