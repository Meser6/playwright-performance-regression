import { test as setup } from '@playwright/test';
import { record } from './record.ts';

setup('setup', ({}, testInfo) => {
  record(testInfo);
});
