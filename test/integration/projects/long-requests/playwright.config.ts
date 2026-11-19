// Integration project "long-requests": pages with a long poll, a streamed fetch and an
// EventSource that are still open when the test ends. The collector waits at most
// measure.pendingTimeoutMs for them; with EXCLUDE_LONG=1 they are excluded and not awaited.
import { defineConfig } from '@playwright/test';
import { withPerf } from 'playwright-performance-regression/config';
import perfConfig from './pw-perf.config.ts';

export default withPerf(
  defineConfig({
    testDir: 'tests',
    timeout: 20_000,
    reporter: [['list'], ['json', { outputFile: 'results.json' }]],
    use: { baseURL: process.env.BASE_URL },
  }),
  perfConfig,
);
