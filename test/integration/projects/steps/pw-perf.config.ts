import { definePerfConfig } from 'playwright-performance-regression';

export default definePerfConfig({
  measure: {
    api: process.env.API_OFF !== '1',
    steps: process.env.STEPS_OFF === '1' ? false : true,
  },
});
