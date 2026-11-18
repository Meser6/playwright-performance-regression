import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Own tests never retry: a flaky test is fixed, not retried (12-REQ-06).
    retry: 0,
  },
});
