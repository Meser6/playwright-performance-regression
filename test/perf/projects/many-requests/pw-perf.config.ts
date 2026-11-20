import { definePerfConfig } from '../../../../dist/config.js';

const out = process.env.INTEGRATION_OUT ?? 'out';

export default definePerfConfig({
  run: { repeat: { test: 1, thresholds: 1 }, keepReporters: ['./probe-reporter.mjs'] },
  report: { dir: `${out}/pw-perf-results` },
  thresholds: { dir: out },
});
