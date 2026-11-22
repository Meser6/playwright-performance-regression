import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

// test/setup/playwright-cache.ts gives each Vitest worker its own Playwright transform cache
// through PLAYWRIGHT_TRANSFORM_CACHE_DIR / PWTEST_CACHE_DIR, which Playwright does not document.
// If a Playwright upgrade drops both, the parallel integration tests would race on one cache
// again (12-REQ-06): fail loudly here.
const VARIABLES = ['PLAYWRIGHT_TRANSFORM_CACHE_DIR', 'PWTEST_CACHE_DIR'];

describe('Playwright transform cache per worker', () => {
  test('the installed Playwright reads a cache directory variable and the setup file sets it', () => {
    const fromTest = createRequire(createRequire(import.meta.url).resolve('@playwright/test'));
    const lib = join(dirname(fromTest.resolve('playwright/package.json')), 'lib');
    const read = new Set<string>();
    for (const file of readdirSync(lib, { recursive: true, encoding: 'utf8' })) {
      if (!file.endsWith('.js')) continue;
      const code = readFileSync(join(lib, file), 'utf8');
      for (const name of VARIABLES) if (code.includes(`process.env.${name}`)) read.add(name);
    }
    expect(read.size).toBeGreaterThan(0);
    for (const name of VARIABLES) {
      expect(process.env[name]).toContain('pw-perf-test-transform-cache');
    }
  });
});
