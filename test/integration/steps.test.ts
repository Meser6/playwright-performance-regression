// test.step timings with real Playwright (06, chapter 11): project "steps" and the
// playwright-bdd scenarios of "existing-project".
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { bddgen, RUN_TIMEOUT, startHarness, warningCodes } from './harness.ts';
import type { Harness } from './harness.ts';

let harness: Harness;
beforeAll(async () => {
  harness = await startHarness();
});
afterAll(async () => {
  await harness?.close();
});

const PERF = { PW_PERF_MODE: 'test', PW_PERF_PASSES: '3' };

describe('steps project', () => {
  let dir = '';
  beforeAll(() => {
    dir = harness.copy('steps');
  });

  test(
    '06-AC-09 06-AC-16 nested steps, hooks, fixtures, box, skip and setup in 3 passes',
    async () => {
      const run = await harness.run(dir, { env: PERF });
      expect(run.status, run.output).toBe(0);
      const steps = run.report?.steps ?? {};
      const a = steps.a;
      const b = steps['a › b'];
      expect(a?.statuses).toEqual({ ok: 3 });
      expect(b?.statuses).toEqual({ ok: 3 });
      // setTimeout(200) measured with a 1 ms wall clock can end at 199 ms (06-AC-09, 06-REQ-17).
      expect(b?.stats?.min).toBeGreaterThanOrEqual(198);
      expect(b?.stats?.max).toBeLessThan(400);
      expect(a?.stats?.min).toBeGreaterThanOrEqual(b?.stats?.min ?? 0);
      // Hooks and fixtures are transparent: the keys are the step titles (06-REQ-20).
      expect(steps['open app']?.count).toBe(6);
      expect(steps['seed data']?.count).toBe(3);
      expect(steps.boxed?.count).toBe(3);
      expect(steps.skipped).toBeUndefined();
      expect(steps.caught).toMatchObject({ errorCount: 3, statuses: { error: 3 } });
      expect(steps['login in setup']).toBeUndefined();
      expect(warningCodes(run)).toContain('STATS_SAMPLES_OUTSIDE_MEASURED_PROJECTS');
      expect(steps['a › b']?.location?.file).toBe('tests/steps.spec.ts');
      expect(run.report?.stepNormalization).toMatch(/^[0-9a-f]{14}$/u);
      expect(run.output).toMatch(/│ +│ Endpoints │ Steps │/u);
    },
    RUN_TIMEOUT,
  );

  test(
    '06-AC-20 06-AC-21 titles with an e-mail, a token URL and a JWT never reach any output',
    async () => {
      const run = await harness.run(dir, { env: { ...PERF, PW_PERF_MODE: 'thresholds' } });
      expect(run.status, run.output).toBe(0);
      const keys = Object.keys(run.report?.steps ?? {});
      expect(keys).toEqual(
        expect.arrayContaining(['Login as :email', 'Open :url', 'Use :secret', 'Open order :id']),
      );
      expect(warningCodes(run)).toContain('STEPS_SECRET_REDACTED');
      const results = join(dir, 'reports/pw-perf');
      const texts = [
        run.output,
        ...readdirSync(results).map((f) => readFileSync(join(results, f), 'utf8')),
        readFileSync(join(dir, 'pw-perf-thresholds.steps.json'), 'utf8'),
      ];
      for (const secret of [
        'jan.kowalski@example.com',
        'SECRET123TOKEN456',
        'eyJhbGciOiJIUzI1NiJ9',
      ]) {
        for (const text of texts) expect(text).not.toContain(secret);
      }
    },
    RUN_TIMEOUT,
  );

  test(
    '06-AC-10 with measure.steps off the report has no steps and the step file is not needed',
    async () => {
      const off = dir;
      rmSync(join(off, 'pw-perf-thresholds.steps.json'), { force: true });
      const run = await harness.run(off, {
        env: { ...PERF, STEPS_OFF: '1' },
      });
      expect(run.status, run.output).toBe(0);
      expect(run.report?.steps).toEqual({});
      expect(run.report?.stepNormalization).toBeNull();
      expect(readdirSync(off)).not.toContain('pw-perf-thresholds.steps.json');
      expect(run.output).not.toContain('│ Steps │');
    },
    RUN_TIMEOUT,
  );

  test(
    '03-AC-20 with measure.api off a thresholds run measures only steps',
    async () => {
      for (const name of ['pw-perf-thresholds.json', 'pw-perf-thresholds.steps.json']) {
        rmSync(join(dir, name), { force: true });
      }
      const run = await harness.run(dir, {
        env: { ...PERF, PW_PERF_MODE: 'thresholds', API_OFF: '1' },
      });
      expect(run.status, run.output).toBe(0);
      expect(run.report?.config.measure?.api).toBe(false);
      expect(run.report?.endpoints).toEqual({});
      expect(Object.keys(run.report?.steps ?? {})).toContain('a › b');
      expect(readdirSync(dir)).toContain('pw-perf-thresholds.steps.json');
      expect(readdirSync(dir)).not.toContain('pw-perf-thresholds.json');
      expect(warningCodes(run)).not.toContain('TESTS_NOT_INSTRUMENTED');
      expect(warningCodes(run)).not.toContain('RUN_PROJECT_NO_REQUESTS');
    },
    RUN_TIMEOUT,
  );
});

describe('playwright-bdd scenarios', () => {
  test(
    'Gherkin steps become step keys (06, chapter 9)',
    async () => {
      const dir = harness.copy('existing-project');
      bddgen(dir);
      const run = await harness.run(dir, { env: { ...PERF, PERF_STEPS: '1' } });
      const keys = Object.keys(run.report?.steps ?? {});
      expect(keys, run.output).toEqual(
        expect.arrayContaining([
          'Given I open the shop',
          'When I load the catalog',
          'Then the catalog is shown',
        ]),
      );
    },
    RUN_TIMEOUT,
  );
});
