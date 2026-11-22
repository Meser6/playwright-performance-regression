import { definePerfConfig } from '../../../../dist/config.js';

const out = process.env.INTEGRATION_OUT ?? 'out';

export default definePerfConfig({
  run: { passes: { test: 5, thresholds: 5 } },
  report: { dir: `${out}/reports/pw-perf` },
  thresholds: { dir: process.env.THRESHOLDS_DIR ?? out },
});
