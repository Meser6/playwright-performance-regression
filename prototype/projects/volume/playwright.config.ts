import { defineConfig } from '@playwright/test';
import { withPerf } from '../_shared/with-perf.cjs';

const html = process.env.PROTO_HTML === '1';

export default withPerf(
  defineConfig({
    testDir: 'tests',
    reporter: [
      ['dot'],
      ...(html ? [['html', { open: 'never', outputFolder: 'html-report' }] as const] : []),
      ['../_shared/reporter.mjs'],
    ],
  }),
  { marker: 'volume' },
);
