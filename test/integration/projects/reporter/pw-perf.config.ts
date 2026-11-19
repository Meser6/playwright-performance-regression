import { definePerfConfig } from '../../../../dist/config.js';

const out = process.env.INTEGRATION_OUT ?? 'out';

export default definePerfConfig({
  run: { repeat: { test: 5, thresholds: 5 } },
  report: { dir: `${out}/perf-results` },
  thresholds: { dir: process.env.THRESHOLDS_DIR ?? out },
});
