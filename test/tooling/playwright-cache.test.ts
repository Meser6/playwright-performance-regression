import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

// test/setup/playwright-cache.ts gives each Vitest worker its own Playwright transform cache
// through PWTEST_CACHE_DIR, an undocumented variable of Playwright. If a Playwright upgrade drops
// it, the parallel integration tests would race on one cache again (12-REQ-06): fail loudly here.
describe('Playwright transform cache per worker', () => {
  test('the installed Playwright reads PWTEST_CACHE_DIR and the setup file sets it', () => {
    const fromTest = createRequire(createRequire(import.meta.url).resolve('@playwright/test'));
    const playwright = dirname(fromTest.resolve('playwright/package.json'));
    const cache = readFileSync(join(playwright, 'lib/transform/compilationCache.js'), 'utf8');
    expect(cache).toContain('process.env.PWTEST_CACHE_DIR');
    expect(process.env.PWTEST_CACHE_DIR).toContain('pw-perf-test-transform-cache');
  });
});
