// Integration project "custom-fixtures": a project with its own fixtures.ts (03, chapter 3.4):
// context overrides before and after withPerfFixtures(), a page on its own context, role pages
// and a worker-scoped logged-in context.
import { defineConfig } from '@playwright/test';
import { withPerf } from 'playwright-performance-regression/config';
import perfConfig from './pw-perf.config.ts';

export default withPerf(
  defineConfig({
    testDir: 'tests',
    timeout: 20_000,
    reporter: [['list'], ['json', { outputFile: 'results.json' }]],
    use: { baseURL: process.env.BASE_URL },
  }),
  perfConfig,
);
