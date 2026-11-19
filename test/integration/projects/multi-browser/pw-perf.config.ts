import { definePerfConfig } from 'playwright-performance-regression';

const projects = process.env.PERF_PROJECTS;

export default definePerfConfig({
  run: {
    keepReporters: ['json'],
    projects: projects === undefined ? 'auto' : projects.split(','),
  },
});
