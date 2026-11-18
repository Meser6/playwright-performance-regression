import { defineConfig } from '@playwright/test';
import { withPerf } from '../_shared/with-perf.cjs';
// Extensionless import of the package config, as in the documented setup.
import perfConfig from './pw-perf.noext.config';

export default withPerf(
  defineConfig({
    testDir: 'tests',
    reporter: [['list'], ['../_shared/reporter.mjs']],
    use: { baseURL: process.env.PROTO_BASE },
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  }),
  perfConfig,
);
