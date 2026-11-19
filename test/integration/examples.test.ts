// The example projects in examples/ (13, chapter 8.3) run as integration tests: copies with the
// built package linked, against the demo server (BASE_URL, so their webServer is not started),
// through the built CLI: a thresholds run, then a test run against the derived files.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { endpointKeys, expectStatus, RUN_TIMEOUT, ROOT, startHarness } from './harness.ts';
import type { Harness } from './harness.ts';

const EXAMPLES = join(ROOT, 'examples');
let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness?.close();
});

describe.each([
  ['basic', ['GET /api/cart', 'GET /api/products', 'GET /api/search?page&q', 'GET /api/users/:id']],
  [
    'with-setup',
    [
      'GET /api/cart',
      'GET /api/cart/items',
      'GET /api/products',
      'GET /api/users/:id',
      'GET api/api/prices',
    ],
  ],
])('examples/%s', (name, keys) => {
  let dir = '';
  beforeAll(() => {
    dir = harness.copy(name, EXAMPLES);
  });

  test(
    '01-AC-05 perf:thresholds then perf:test pass with the derived thresholds',
    async () => {
      const scripts = (
        JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
          scripts: Record<string, string>;
        }
      ).scripts;
      const args = (script: string): string[] =>
        (scripts[script] ?? '').replace(/^pw-perf /u, '').split(' ');

      const thresholds = await harness.run(dir, {
        cli: true,
        args: [...args('perf:thresholds'), '--repeat', '5'],
      });
      expectStatus(thresholds, 0);
      expect(existsSync(join(dir, 'perf-thresholds.api.json'))).toBe(true);
      expect(endpointKeys(thresholds).filter((key) => key.includes('/api/'))).toEqual(keys);

      const run = await harness.run(dir, {
        cli: true,
        args: [...args('perf:test'), '--repeat', '5'],
      });
      expectStatus(run, 0);
      expect(run.report?.mode).toBe('test');
      expect(existsSync(join(dir, 'perf-results/report.html'))).toBe(true);
    },
    RUN_TIMEOUT,
  );

  test(
    'the plain Playwright run passes',
    async () => {
      expectStatus(await harness.run(dir), 0);
    },
    RUN_TIMEOUT,
  );
});
