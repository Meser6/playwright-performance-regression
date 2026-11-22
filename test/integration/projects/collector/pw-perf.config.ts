import { definePerfConfig } from '../../../../dist/config.js';

const pending = process.env.PENDING_TIMEOUT_MS;
const out = process.env.INTEGRATION_OUT ?? 'out';

export default definePerfConfig({
  run: { passes: { test: 1 }, keepReporters: ['./record-reporter.mjs'] },
  report: { dir: `${out}/reports/pw-perf` },
  measure: pending === undefined ? {} : { pendingTimeoutMs: Number(pending) },
});
