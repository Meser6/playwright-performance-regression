import { test } from '@playwright/test';
import { record } from './record';

test('measured', ({}, testInfo) => {
  record(testInfo);
});
