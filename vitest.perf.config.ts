import { defineConfig } from 'vitest/config';

// Performance and statistical tests (12, chapter 7): `pnpm test:perf` (nightly) and
// `pnpm test:stats` (weekly). One file at a time, so timings do not compete; --expose-gc for the
// memory test. Never retried (12-REQ-06).
export default defineConfig({
  test: {
    include: ['test/perf/**/*.test.ts', 'test/stats/**/*.test.ts'],
    retry: 0,
    setupFiles: ['test/setup/playwright-cache.ts'],
    fileParallelism: false,
    pool: 'forks',
    execArgv: ['--expose-gc'],
    testTimeout: 900_000,
    hookTimeout: 120_000,
  },
});
