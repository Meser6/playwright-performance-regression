import { definePerfConfig, perfDefaults } from 'playwright-performance-regression';

// The API runs on its own origin: give it a short label for the endpoint keys.
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

export default definePerfConfig({
  keys: { origins: { [apiUrl]: 'api' } },
  measure: {
    exclude: [...perfDefaults.measure.exclude, '/api/analytics'],
    // Also measure the test.step blocks of the page objects (docs/steps.md).
    steps: true,
  },
  // Derived thresholds with the recommended headroom (strict / normal / loose).
  thresholds: { preset: 'normal' },
});
