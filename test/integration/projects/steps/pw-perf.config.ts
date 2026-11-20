import { definePerfConfig } from 'playwright-performance-regression';

export default definePerfConfig({
  measure: { steps: process.env.STEPS_OFF === '1' ? false : true },
});
