export default {
  run: { repeat: { test: 2 }, keepReporters: ['./record-reporter.mjs'] },
  keys: { origins: { 'https://api.example.com': 'mjs' } },
};
