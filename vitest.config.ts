import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The performance and statistical tests run nightly and weekly (vitest.perf.config.ts).
    exclude: [...configDefaults.exclude, 'test/perf/**', 'test/stats/**'],
    // Own tests never retry: a flaky test is fixed, not retried (12-REQ-06).
    retry: 0,
  },
});
