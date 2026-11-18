import { definePerfConfig } from '../../../../dist/config.js';

const pending = process.env.PENDING_TIMEOUT_MS;

export default definePerfConfig({
  run: { repeat: { test: 1 }, keepReporters: ['./record-reporter.mjs'] },
  measure: pending === undefined ? {} : { pendingTimeoutMs: Number(pending) },
});
