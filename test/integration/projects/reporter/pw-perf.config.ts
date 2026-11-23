import { definePerfConfig } from '../../../../dist/config.js';

const out = process.env.INTEGRATION_OUT ?? 'out';

export default definePerfConfig({
  run: { passes: { test: 5, thresholds: 5 } },
  report: { dir: `${out}/reports/pw-perf` },
  thresholds: { dir: process.env.THRESHOLDS_DIR ?? out },
  // GATE_WARN_ONLY=1: violations only warn. Thresholds derived from a few milliseconds of a local
  // server leave ~100 ms of headroom, which one slow navigation on a loaded CI runner exceeds;
  // tests that are not about the verdict use it so the timing of the machine cannot fail them.
  ...(process.env.GATE_WARN_ONLY === '1'
    ? { gate: { tolerance: '100%', hardLimitFactor: null } }
    : {}),
});
