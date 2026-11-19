// @ts-check
// Input of the init wizard tests (04-AC-17): CommonJS, JavaScript, pnpm, GitLab CI.
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  timeout: 20_000,
  reporter: 'dot',
  use: { baseURL: process.env.DEMO_URL },
});
