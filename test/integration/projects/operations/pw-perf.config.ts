import { definePerfConfig } from '../../../../dist/config.js';

const out = process.env.INTEGRATION_OUT ?? 'out';

export default definePerfConfig({
  run: { passes: { test: 3, thresholds: 3 }, keepReporters: ['../collector/record-reporter.mjs'] },
  report: { dir: `${out}/reports/pw-perf` },
  thresholds: { dir: process.env.THRESHOLDS_DIR ?? out },
  // OPERATIONS=1: a key per GraphQL operation and tRPC procedure (18-REQ-01).
  keys:
    process.env.OPERATIONS === '1'
      ? {
          operations: [
            { type: 'graphql', match: '/graphql' },
            { type: 'trpc', match: /^\/api\/trpc\// },
          ],
        }
      : {},
});
