import { definePerfConfig } from 'playwright-performance-regression';

export default definePerfConfig({
  run: { keepReporters: ['json'] },
});
