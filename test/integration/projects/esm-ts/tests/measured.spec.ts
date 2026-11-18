import { test } from '@playwright/test';
import { record } from './record.ts';

test('measured', ({}, testInfo) => {
  record(testInfo);
});
