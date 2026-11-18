const { defineConfig } = require('@playwright/test');
const { withPerf } = require('../_shared/with-perf.cjs');
const perfConfig = require('./pw-perf.plain.config.ts');

module.exports = withPerf(
  defineConfig({
    testDir: 'tests',
    reporter: [['list'], ['../_shared/reporter.mjs']],
    use: { baseURL: process.env.PROTO_BASE },
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  }),
  perfConfig.default ?? perfConfig,
);
