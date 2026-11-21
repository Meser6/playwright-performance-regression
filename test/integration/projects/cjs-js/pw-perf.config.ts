import { definePerfConfig } from '../../../../dist/config.cjs';

export default definePerfConfig({
  run: { passes: { test: 2 }, keepReporters: ['./record-reporter.mjs'] },
  keys: { origins: { 'https://api.example.com': 'cjs' } },
});
