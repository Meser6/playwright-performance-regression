import { test as teardown } from '@playwright/test';
import { record } from './record.ts';

teardown('cleanup', ({}, testInfo) => {
  record(testInfo);
});
