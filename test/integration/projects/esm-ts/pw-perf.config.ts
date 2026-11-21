import { definePerfConfig } from '../../../../dist/config.js';

const keep = ['./record-reporter.mjs', ...(process.env.INTEGRATION_KEEP_JUNIT ? ['junit'] : [])];

export default definePerfConfig({
  run: {
    passes: { test: 2 },
    keepReporters: keep,
    projects: process.env.INTEGRATION_PROJECTS
      ? process.env.INTEGRATION_PROJECTS.split(',')
      : 'auto',
  },
  keys: { origins: { 'https://api.example.com': 'ts' } },
});
