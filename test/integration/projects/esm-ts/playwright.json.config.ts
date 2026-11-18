// Integration project: ESM, package config in pw-perf.config.json.
import { defineConfig } from '@playwright/test';
import { withPerf } from '../../../../dist/config.js';
import perfConfig from './pw-perf.config.json' with { type: 'json' };

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
