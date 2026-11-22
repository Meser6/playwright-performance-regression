// The example projects in examples/ (13, chapter 8.3) run as integration tests: copies with the
// built package linked, against the demo server (BASE_URL, so their webServer is not started),
// in the environment mode: a thresholds run, then a test run against the derived files.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  [
    'basic',
    [
      'GET /api/cart',
      'GET /api/products',
      'GET /api/search?page&q',
      'GET /api/users/:id',
      'request GET /api/products',
    ],
  ],
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
    '01-AC-05 a thresholds run then a test run pass with the derived thresholds',
    async () => {
      const scripts = (
        JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
          scripts: Record<string, string>;
        }
      ).scripts;
      // The documented command: PW_PERF_MODE in front of the example's test script (04-REQ-70).
      const script = scripts['test:perf'] ?? scripts['test'] ?? '';
      const args = script
        .replace(/^playwright test ?/u, '')
        .split(' ')
        .filter(Boolean);

      const thresholds = await harness.run(dir, {
        args,
        env: { PW_PERF_MODE: 'thresholds', PW_PERF_PASSES: '5' },
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
        args,
        env: { PW_PERF_MODE: 'test', PW_PERF_PASSES: '5' },
      });
      expectStatus(run, 0);
      expect(run.report?.mode).toBe('test');
      expect(existsSync(join(dir, 'reports/pw-perf/report.html'))).toBe(true);
    },
    RUN_TIMEOUT,
  );

  test.runIf(name === 'basic')(
    '04-AC-38 PW_PERF_THRESHOLDS_DIR keeps the thresholds of the wizard check out of the project',
    async () => {
      // The variables of the wizard's check (04-REQ-58, v4 D4b); the project's files stay as they are.
      const tmp = mkdtempSync(join(tmpdir(), 'pw-perf-check-'));
      const before = readdirSync(dir).filter((f) => f.startsWith('pw-perf-thresholds'));
      const contents = before.map((f) => readFileSync(join(dir, f), 'utf8'));
      try {
        // The 2 passes of the check: PW_PERF_MIN_SAMPLES=2 lets this small suite derive (04-D-46).
        const env = { PW_PERF_PASSES: '2', PW_PERF_THRESHOLDS_DIR: tmp, PW_PERF_MIN_SAMPLES: '2' };
        const thresholds = await harness.run(dir, {
          env: { ...env, PW_PERF_MODE: 'thresholds' },
        });
        expectStatus(thresholds, 0);
        expect(readdirSync(tmp)).toContain('pw-perf-thresholds.json');
        const run = await harness.run(dir, { env: { ...env, PW_PERF_MODE: 'test' } });
        expectStatus(run, 0);
        expect(run.report?.config.thresholds?.dir).toBe(tmp);
        expect(warningCodes(run)).not.toContain('THRESHOLDS_FILE_MISSING');
        const after = readdirSync(dir).filter((f) => f.startsWith('pw-perf-thresholds'));
        expect(after).toEqual(before);
        expect(after.map((f) => readFileSync(join(dir, f), 'utf8'))).toEqual(contents);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
    RUN_TIMEOUT,
  );

  test(
    '15-AC-05 request keys share the endpoints file and fail the run like browser keys',
    async (context) => {
      // Only examples/basic has an API test.
      if (name !== 'basic') context.skip();
      // Derived by the first test: one file with both sources of GET /api/products.
      const file = join(dir, 'pw-perf-thresholds.json');
      const derived = JSON.parse(readFileSync(file, 'utf8')) as {
        entries: Record<string, object>;
      };
      expect(Object.keys(derived.entries)).toEqual(
        expect.arrayContaining(['GET /api/products', 'request GET /api/products']),
      );
      expect(existsSync(join(dir, 'pw-perf-thresholds.requests.json'))).toBe(false);
      const original = readFileSync(file, 'utf8');
      try {
        derived.entries = {
          ...derived.entries,
          'request GET /api/products': { locked: true, median: 1 },
        };
        writeFileSync(file, JSON.stringify(derived, null, 2));
        const run = await harness.run(dir, { env: { PW_PERF_MODE: 'test', PW_PERF_PASSES: '5' } });
        expectStatus(run, 1);
        expect(run.outcome?.exitCode).toBe(2);
        expect(run.report?.evaluation.status).toBe('failed');
        expect(run.output).toMatch(/│ ❌ │ api +│ request GET \/api\/products +│ median/u);
        const endpoints = run.report?.endpoints ?? {};
        expect(endpoints['request GET /api/products']?.evaluation.result).toBe('fail');
        expect(endpoints['GET /api/products']?.evaluation.result).toBe('pass');
      } finally {
        writeFileSync(file, original);
      }
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
