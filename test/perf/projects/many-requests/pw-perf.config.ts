import { definePerfConfig } from '../../../../dist/config.js';

const out = process.env.INTEGRATION_OUT ?? 'out';

export default definePerfConfig({
  run: { passes: { test: 1, thresholds: 1 }, keepReporters: ['./probe-reporter.mjs'] },
  report: { dir: `${out}/reports/pw-perf` },
  thresholds: { dir: out },
});
