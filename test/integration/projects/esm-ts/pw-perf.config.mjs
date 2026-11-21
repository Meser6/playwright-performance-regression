export default {
  run: { passes: { test: 2 }, keepReporters: ['./record-reporter.mjs'] },
  keys: { origins: { 'https://api.example.com': 'mjs' } },
};
