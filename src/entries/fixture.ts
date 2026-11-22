// Package entry point "playwright-performance-regression/fixture" (01, chapter 9): loaded in
// Playwright workers. It does not import @playwright/test at runtime (01-REQ-15).
export { trackContext, trackRequestContext, withPerfFixtures } from '../collector/index.ts';
export type { PerfApi, PerfFixtures, PerfTestType } from '../collector/index.ts';
