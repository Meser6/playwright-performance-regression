// Input of the init wizard tests (04-AC-17): ESM, TypeScript, own fixtures file, GitHub Actions.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 20_000,
  reporter: 'list',
  use: {
    baseURL: process.env.DEMO_URL ?? 'https://api.example.com',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
