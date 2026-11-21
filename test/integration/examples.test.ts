// The example projects in examples/ (13, chapter 8.3) run as integration tests: copies with the
// built package linked, against the demo server (BASE_URL, so their webServer is not started),
// through the built CLI: a thresholds run, then a test run against the derived files.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  endpointKeys,
  expectStatus,
  RUN_TIMEOUT,
  ROOT,
  startHarness,
  warningCodes,
} from './harness.ts';
import type { Harness } from './harness.ts';

const EXAMPLES = join(ROOT, 'examples');
const NO_STEPS = 'No test.step blocks found, so there are no step thresholds.';
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
        args: [...args('perf:thresholds'), '--passes', '5'],
      });
      expectStatus(thresholds, 0);
      expect(existsSync(join(dir, 'pw-perf-thresholds.json'))).toBe(true);
      expect(endpointKeys(thresholds).filter((key) => key.includes('/api/'))).toEqual(keys);
      if (name === 'with-setup') {
        // The page object's test.step, measured by default (13-REQ-16, 03-REQ-18, docs/steps.md).
        expect(Object.keys(thresholds.report?.steps ?? {})).toEqual(['open shop']);
        expect(existsSync(join(dir, 'pw-perf-thresholds.steps.json'))).toBe(true);
        expect(thresholds.output).not.toContain(NO_STEPS);
      } else {
        // No test.step: one informational line, no warning and no step file (06-REQ-29).
        expect(thresholds.output).toContain(NO_STEPS);
        expect(warningCodes(thresholds).filter((c) => c.startsWith('STEPS_'))).toEqual([]);
        expect(existsSync(join(dir, 'pw-perf-thresholds.steps.json'))).toBe(false);
      }

      const run = await harness.run(dir, {
        cli: true,
        args: [...args('perf:test'), '--passes', '5'],
      });
      expectStatus(run, 0);
      expect(run.report?.mode).toBe('test');
      expect(existsSync(join(dir, 'pw-perf-results/report.html'))).toBe(true);
    },
    RUN_TIMEOUT,
  );

  test.runIf(name === 'with-setup')(
    '09-AC-25 a slower step fails the run like an endpoint, without step config',
    async () => {
      // The derived step file of the first test, with the step's median locked far below its time.
      const file = join(dir, 'pw-perf-thresholds.steps.json');
      const derived = JSON.parse(readFileSync(file, 'utf8')) as { entries: object };
      derived.entries = { ...derived.entries, 'open shop': { locked: true, median: 1 } };
      writeFileSync(file, JSON.stringify(derived, null, 2));

      const run = await harness.run(dir, { env: { PW_PERF_MODE: 'test', PW_PERF_PASSES: '3' } });
      expectStatus(run, 1);
      expect(run.report?.evaluation.status).toBe('failed');
      expect(run.output).toMatch(/│ ❌ │ step +│ open shop +│ median/u);
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
