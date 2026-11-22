import { definePerfConfig } from '../../../../dist/config.js';

const keep = ['./record-reporter.mjs', ...(process.env.INTEGRATION_KEEP_JUNIT ? ['junit'] : [])];

export default definePerfConfig({
  run: {
    passes: { test: 2 },
    keepReporters: keep,
    grep: process.env.INTEGRATION_GREP ?? null,
  },
  keys: { origins: { 'https://api.example.com': 'ts' } },
});
