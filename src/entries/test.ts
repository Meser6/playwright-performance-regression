// Package entry point "playwright-performance-regression/test" (01, chapter 9; D-14): a ready
// `test` for projects that import it straight from @playwright/test. The only entry point that
// imports @playwright/test at runtime (01-REQ-26, 03-REQ-02).
import { test as base } from '@playwright/test';
import { withPerfFixtures } from '../collector/index.ts';

export const test = withPerfFixtures(base);
export { expect } from '@playwright/test';
