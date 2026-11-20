import { definePerfConfig } from 'playwright-performance-regression';

export default definePerfConfig({
  run: { keepReporters: ['junit', 'json'] },
  // Steps of the playwright-bdd scenarios (06, chapter 9); on only in the steps test.
  measure: { steps: process.env.PERF_STEPS === '1' },
});
