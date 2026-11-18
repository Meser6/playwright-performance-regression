// Integration project: CommonJS, JavaScript config, package config in pw-perf.config.ts loaded
// with require(): the TypeScript default export arrives as .default (03, chapter 4; V-02).
// The package is required from its CJS build in dist/.
const { defineConfig } = require('@playwright/test');
const { withPerf } = require('../../../../dist/config.cjs');

const out = process.env.INTEGRATION_OUT ?? 'out';

module.exports = withPerf(
  defineConfig({
    testDir: 'tests',
    outputDir: `${out}/test-results`,
    reporter: [['dot'], ['./record-reporter.mjs']],
  }),
  require('./pw-perf.config.ts').default,
);
