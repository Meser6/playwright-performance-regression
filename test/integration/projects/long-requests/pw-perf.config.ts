import { definePerfConfig, perfDefaults } from 'playwright-performance-regression';

export default definePerfConfig({
  run: { keepReporters: ['json'] },
  measure:
    process.env.EXCLUDE_LONG === '1'
      ? { exclude: [...perfDefaults.measure.exclude, '/api/hang', '/api/stream'] }
      : {},
});
