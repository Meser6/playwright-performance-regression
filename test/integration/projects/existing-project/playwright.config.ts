// Integration project "existing-project": a typical project that adopts the package (03,
// chapter 3.4): a config wrapper, a global timeout and maxFailures, own reporters, a login
// setup project, a Firefox project, several test objects, mergeTests, page.route mocks, a
// flaky test and playwright-bdd. OUTER_WRAPPER=1 puts the wrapper outside withPerf().
import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
import { withPerf } from 'playwright-performance-regression/config';
import { withCompanyDefaults } from './company-defaults.ts';
import perfConfig from './pw-perf.config.ts';

const bddDir = defineBddConfig({ features: 'features/*.feature', steps: 'features/steps.ts' });

const config = defineConfig({
  testDir: 'tests',
  timeout: 20_000,
  globalTimeout: 600_000,
  maxFailures: 5,
  reporter: [
    ['list'],
    ['junit', { outputFile: 'junit.xml' }],
    ['json', { outputFile: 'results.json' }],
    ['./audit-reporter.mjs'],
  ],
  use: { baseURL: process.env.BASE_URL },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'bdd',
      testDir: bddDir,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Firefox'] },
    },
  ],
});

export default process.env.OUTER_WRAPPER === '1'
  ? withCompanyDefaults(withPerf(config, perfConfig))
  : withPerf(withCompanyDefaults(config), perfConfig);
