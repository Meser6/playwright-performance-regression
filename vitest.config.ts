import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The performance and statistical tests run nightly and weekly (vitest.perf.config.ts).
    exclude: [...configDefaults.exclude, 'test/perf/**', 'test/stats/**'],
    // Own tests never retry: a flaky test is fixed, not retried (12-REQ-06).
    retry: 0,
    // One Playwright transform cache per worker: parallel Playwright runs must not share one
    // (test/setup/playwright-cache.ts).
    setupFiles: ['test/setup/playwright-cache.ts'],
    // Shared Windows and macOS runners are several times slower than a laptop; a test timeout is
    // a hang guard, not a performance limit (performance limits live in test/perf, 12-D-05).
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
