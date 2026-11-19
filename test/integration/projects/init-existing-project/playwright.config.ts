// Input of the init wizard tests (04-AC-18): a config wrapper and several test objects.
import { defineConfig } from '@playwright/test';
import { withCompanyDefaults } from './company-defaults';

export default withCompanyDefaults(
  defineConfig({
    testDir: 'tests',
    globalTimeout: 600_000,
    use: { baseURL: 'https://shop.example.com' },
  }),
);
