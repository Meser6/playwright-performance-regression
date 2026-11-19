import { definePerfConfig, perfDefaults } from 'playwright-performance-regression';

// The API runs on its own origin: give it a short label for the endpoint keys.
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

export default definePerfConfig({
  keys: { origins: { [apiUrl]: 'api' } },
  measure: { exclude: [...perfDefaults.measure.exclude, '/api/analytics'] },
  // Report violations without failing the run while the thresholds settle.
  gate: { warnOnly: true },
});
