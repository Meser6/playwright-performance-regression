// Integration project: ESM, package config in pw-perf.config.mjs.
import { defineConfig } from '@playwright/test';
import { withPerf } from '../../../../dist/config.js';
import perfConfig from './pw-perf.config.mjs';

const out = process.env.INTEGRATION_OUT ?? 'out';

export default withPerf(
  defineConfig({
    testDir: 'tests',
    testMatch: /.*\.spec\.ts/,
    outputDir: `${out}/test-results`,
    reporter: [['dot'], ['./record-reporter.mjs']],
  }),
  perfConfig,
);
