import { describe, expect, test } from 'vitest';
import { allowedViolations, evaluate } from '../../../src/core/evaluate/index.ts';
import type { Evaluation } from '../../../src/core/evaluate/index.ts';
import { stringifyStable } from '../../../src/core/format/index.ts';
import { buildRunReport, checkUsage } from '../../../src/core/report/index.ts';
import { parseRunReport } from '../../../src/core/schema/index.ts';
import { wilsonBounds } from '../../../src/core/stats/index.ts';
import type {
  Check,
  EvaluatedCheck,
  EvaluatedKey,
  Generated,
  Kind,
  RunReport,
  ThresholdsEntry,
} from '../../../src/core/types/index.ts';
import { loadCases } from '../../contract/golden.ts';
import {
  NO_TEST_BREAKDOWN,
  SOURCE,
  aggregates,
  files,
  config,
  invalid,
  loadEvaluateCases,
  loaded,
  missing,
  options,
  runGoldenCase,
} from './evaluate-helpers.ts';
import type { AggregateSpec } from './evaluate-helpers.ts';

const KEY = 'GET /api/tickets';

function golden(prefix: string): Evaluation {
  const c = loadEvaluateCases().find((x) => x.name.startsWith(`${prefix}-`));
  if (c === undefined) throw new Error(prefix);
  return runGoldenCase(c).evaluation;
}

function failed(e: Evaluation): (EvaluatedCheck & { kind: Kind; key: string })[] {
  return (['api'] as const).flatMap((kind) =>
    Object.entries(e.perKey[kind]).flatMap(([key, k]) =>
      k.checks.filter((c) => !c.passed).map((c) => ({ ...c, kind, key })),
    ),
  );
}

/** Evaluates one api key with the given entry (or none) and config. */
function one(spec: AggregateSpec, entry?: ThresholdsEntry, cfg = config()): EvaluatedKey {
  const e = evaluate(
    aggregates({ [KEY]: spec }),
    files(loaded('api', entry === undefined ? {} : { [KEY]: entry })),
    cfg,
    options(),
  );
  const result = e.perKey.api[KEY];
  if (result === undefined) throw new Error('no key');
  return result;
}

function check(k: EvaluatedKey, rule: Check['rule']): EvaluatedCheck | undefined {
  return k.checks.find((c) => c.rule === rule);
}

const codes = (e: Evaluation): string[] => e.warnings.map((w) => w.code);

describe('gate policy (09, chapter 6)', () => {
  test('09-AC-01 G1: one violation over tolerance 0 blocks; failed', () => {
    const e = golden('G1');
    expect(failed(e).map((c) => [c.key, c.rule, c.blocking])).toEqual([[KEY, 'percentile', true]]);
    expect(e.status).toBe('failed');
  });

  test('09-AC-01 G2: two violations within tolerance 2 do not block; warned', () => {
    const e = golden('G2');
    expect(failed(e)).toHaveLength(2);
    expect(failed(e).every((c) => !c.blocking && !c.hardLimitExceeded)).toBe(true);
    expect(e.status).toBe('warned');
  });

  test('09-AC-01 G3: within tolerance only the hard p99 check blocks; failed', () => {
    const e = golden('G3');
    expect(failed(e).map((c) => [c.key, c.rule, c.hardLimitExceeded, c.blocking])).toEqual([
      [KEY, 'percentile', false, false],
      [KEY, 'p99', true, true],
      ['POST /api/orders', 'percentile', false, false],
    ]);
    expect(e.status).toBe('failed');
  });

  test('09-AC-01 G4: tolerance 5% of 40 allows 2; 3 keys block; failed', () => {
    const e = golden('G4');
    expect(allowedViolations('5%', 40)).toBe(2);
    expect(failed(e)).toHaveLength(3);
    expect(failed(e).every((c) => c.blocking)).toBe(true);
    expect(e.status).toBe('failed');
  });

  test('09-AC-01 G5: defaultThresholds warn does not block even above the hard limit', () => {
    const e = golden('G5');
    expect(
      failed(e).map((c) => [c.rule, c.actual, c.limit, c.hardLimitExceeded, c.blocking]),
    ).toEqual([['percentile', 4500, 2000, true, false]]);
    expect(e.perKey.api['GET /api/reports']?.thresholdSource).toBe('default');
    expect(e.status).toBe('warned');
  });

  test('09-AC-01 G7: an invalid api file gives error without violations', () => {
    const e = golden('G7');
    expect(failed(e)).toEqual([]);
    expect(e.status).toBe('error');
    expect(e.toolErrors.map((i) => i.code)).toEqual(['SCHEMA_INVALID_JSON']);
  });

  test('09-AC-01 G8: apdex upper bound 0.7811 below 0.85 blocks without hard limit', () => {
    const e = golden('G8');
    expect(
      failed(e).map((c) => [c.rule, c.actual, c.observed, c.hardLimitExceeded, c.blocking]),
    ).toEqual([['apdex', 0.7811, 0.7, false, true]]);
    expect(e.status).toBe('failed');
  });

  test('tolerance in percent is computed on integers and rounded down', () => {
    expect(allowedViolations(3, 0)).toBe(3);
    expect(allowedViolations('100%', 7)).toBe(7);
    expect(allowedViolations('2.5%', 40)).toBe(1);
    expect(allowedViolations('7%', 100)).toBe(7);
    expect(allowedViolations('5%', 0)).toBe(0);
    expect(() => allowedViolations('5', 10)).toThrow();
  });

  test('tolerance 100% lets only hard violations block', () => {
    const cfg = config({ gate: { tolerance: '100%' } });
    const e = evaluate(
      aggregates({ 'GET /a': { durations: [[20, 1500]] }, 'GET /b': { durations: [[20, 4100]] } }),
      files(loaded('api', { 'GET /a': { percentile: 1400 }, 'GET /b': { percentile: 2000 } })),
      cfg,
      options(),
    );
    expect(failed(e).map((c) => [c.key, c.rule, c.blocking])).toEqual([
      ['GET /a', 'percentile', false],
      ['GET /b', 'median', true],
      ['GET /b', 'percentile', true],
    ]);
    expect(e.status).toBe('failed');
  });

  test('hardLimitFactor null disables hard limits', () => {
    const k = one(
      { durations: [[20, 9000]] },
      { percentile: 1400 },
      config({ gate: { hardLimitFactor: null } }),
    );
    expect(check(k, 'percentile')).toMatchObject({ passed: false, hardLimitExceeded: false });
  });

  test('hard limit compares with the unrounded product limit × factor', () => {
    const cfg = config({ gate: { hardLimitFactor: 1.5 } });
    expect(
      check(one({ durations: [[20, 2100]] }, { percentile: 1400 }, cfg), 'percentile')
        ?.hardLimitExceeded,
    ).toBe(false);
    expect(
      check(one({ durations: [[20, 2100.1]] }, { percentile: 1400 }, cfg), 'percentile')
        ?.hardLimitExceeded,
    ).toBe(true);
  });

  test('09-AC-07 thresholds mode gives the same checks with gateEnabled false', () => {
    const c = loadEvaluateCases().find((x) => x.name.startsWith('G1-'));
    if (c === undefined) throw new Error('G1');
    const inTest = runGoldenCase(c).evaluation;
    const inThresholds = runGoldenCase({
      ...c,
      input: { ...c.input, options: { ...c.input.options, mode: 'thresholds' } },
    }).evaluation;
    expect(inTest.gateEnabled).toBe(true);
    expect(inThresholds.gateEnabled).toBe(false);
    expect(inThresholds.perKey).toEqual(inTest.perKey);
    expect(inThresholds.status).toBe(inTest.status);
  });

  test('fatalToolError gives status error', () => {
    const e = evaluate(
      aggregates({ [KEY]: { durations: [[20, 100]] } }),
      files(),
      config(),
      options({ fatalToolError: true }),
    );
    expect(e.status).toBe('error');
  });
});

describe('rules (09, chapter 5.2)', () => {
  test('09-AC-02 time rules: equal to the limit passes, 0.1 ms more fails', () => {
    // 100 samples so that p99 runs; all values equal, so every percentile is that value.
    const entry = { median: 1000, percentile: 1000, p99: 1000 };
    const equal = one({ durations: [[100, 1000]] }, entry);
    const above = one({ durations: [[100, 1000.1]] }, entry);
    for (const rule of ['median', 'percentile', 'p99'] as const) {
      expect(check(equal, rule)).toMatchObject({ actual: 1000, limit: 1000, passed: true });
      expect(check(above, rule)).toMatchObject({ actual: 1000.1, limit: 1000, passed: false });
    }
  });

  test('09-AC-02 apdex, wilson and errors: equal to the limit passes, 0.0001 beyond fails', () => {
    const spec: AggregateSpec = {
      durations: [
        [17, 100],
        [3, 1000],
      ],
      errors: 2,
    };
    const probe = one(spec, { t: 500 });
    const apdexActual = check(probe, 'apdex')?.actual ?? Number.NaN;
    const wilsonActual = check(probe, 'wilson')?.actual ?? Number.NaN;
    const errorsActual = check(probe, 'errors')?.actual ?? Number.NaN;
    const at = (minApdex: number, maxWilson: number, maxErrorRate: number) =>
      one(spec, { t: 500, minApdex, maxWilson, maxErrorRate });
    const equal = at(apdexActual, wilsonActual, errorsActual);
    expect(equal.checks.filter((c) => !c.passed)).toEqual([]);
    const beyond = at(
      Math.round((apdexActual + 0.0001) * 1e4) / 1e4,
      Math.round((wilsonActual - 0.0001) * 1e4) / 1e4,
      Math.round((errorsActual - 0.0001) * 1e4) / 1e4,
    );
    expect(beyond.checks.filter((c) => !c.passed).map((c) => c.rule)).toEqual([
      'apdex',
      'wilson',
      'errors',
    ]);
  });

  test('09-AC-03 a rule runs from n = minSamples, not at minSamples - 1', () => {
    const entry = { t: 500 };
    const rules = (n: number) => one({ durations: [[n, 100]] }, entry).checks.map((c) => c.rule);
    expect(rules(4)).toEqual([]);
    expect(rules(5)).toEqual(['median', 'errors']);
    expect(rules(19)).toEqual(['median', 'errors']);
    expect(rules(20)).toEqual(['median', 'percentile', 'apdex', 'wilson', 'errors']);
    expect(rules(99)).not.toContain('p99');
    expect(rules(100)).toContain('p99');
  });

  test('09-AC-03 the errors rule counts all samples N, also failed ones', () => {
    expect(one({ errors: 4 }, {}).checks).toEqual([]);
    expect(one({ errors: 5 }, {}).checks.map((c) => c.rule)).toEqual(['errors']);
    expect(one({ durations: [[3, 100]], errors: 1, other: 1 }).checks.map((c) => c.rule)).toEqual([
      'errors',
    ]);
  });

  test('09-AC-03 minSamples from the config applies per rule', () => {
    const cfg = config({
      checks: { time: { median: { minSamples: 3 } }, errors: { minSamples: 10 } },
    });
    expect(one({ durations: [[3, 100]] }, undefined, cfg).checks.map((c) => c.rule)).toEqual([
      'median',
    ]);
    expect(one({ durations: [[2, 100]] }, undefined, cfg).checks).toEqual([]);
  });

  test('09-AC-04 m = 20 without slow samples passes wilson with the default maxWilson', () => {
    const k = one({ durations: [[20, 100]] }, { t: 500 });
    expect(check(k, 'wilson')).toMatchObject({
      n: 20,
      actual: 0,
      observed: 0,
      limit: 0.05,
      passed: true,
    });
    // The upper bound would fail it (09-D-01).
    expect(wilsonBounds(0, 20)?.upper).toBeGreaterThan(0.05);
  });

  test('09-AC-10 G9: only failed samples; errors lower bound 0.5655 blocks', () => {
    const e = golden('G9');
    const k = e.perKey.api['POST /api/orders'];
    expect(k?.result).toBe('fail');
    expect(k?.checks).toEqual([
      {
        rule: 'errors',
        n: 5,
        actual: 0.5655,
        observed: 1,
        limit: 0.05,
        passed: false,
        hardLimitExceeded: false,
        blocking: true,
      },
    ]);
    expect(e.status).toBe('failed');
  });

  test('09-AC-10 G10: a new key on default thresholds runs no apdex or wilson; passed', () => {
    const e = golden('G10');
    const k = e.perKey.api['GET /api/new'];
    expect(k?.thresholdSource).toBe('default');
    expect(k?.checks.map((c) => [c.rule, c.actual, c.limit, c.passed])).toEqual([
      ['median', 800, 2000, true],
      ['percentile', 1100, 2000, true],
      ['errors', 0, 0.05, true],
    ]);
    expect(e.status).toBe('passed');
  });

  test('09-AC-10 control values of the errors and apdex rules (09-REQ-09)', () => {
    const errorsRule = (n: number, errors: number) =>
      check(one({ durations: [[n - errors, 100]], errors }, {}), 'errors');
    expect(errorsRule(5, 1)).toMatchObject({ actual: 0.0362, passed: true });
    expect(errorsRule(5, 2)).toMatchObject({ actual: 0.1176, passed: false });
    expect(errorsRule(20, 2)?.passed).toBe(true);
    expect(errorsRule(20, 3)).toMatchObject({ actual: 0.0524, passed: false });

    // Apdex 0.90 and 0.85 with T = 500: satisfied ≤ 500, tolerating in (500, 2000], frustrated above.
    const apdexRule = (m: number, satisfied: number, tolerating: number) =>
      check(
        one(
          {
            durations: [
              [satisfied, 100],
              [tolerating, 1000],
              [m - satisfied - tolerating, 3000],
            ],
          },
          { t: 500, minApdex: 0.95, maxWilson: 1, median: 9999, percentile: 9999, p99: 9999 },
        ),
        'apdex',
      );
    expect(apdexRule(20, 18, 0)).toMatchObject({ observed: 0.9, actual: 0.9721, passed: true });
    expect(apdexRule(20, 17, 0)).toMatchObject({ observed: 0.85, actual: 0.9476, passed: false });
    expect(apdexRule(200, 180, 0)).toMatchObject({ observed: 0.9, actual: 0.9343, passed: false });
  });

  test('apdex uses the exact k = S + U / 2 for its bound (09-REQ-09)', () => {
    // S = 6, U = 1 (k = 6.5) of m = 7: the rounded Apdex 0.9286 times m would not give 6.5.
    const k = one(
      {
        durations: [
          [6, 100],
          [1, 1000],
        ],
      },
      { t: 500 },
      config({ checks: { slowShare: { apdex: { minSamples: 5 } } } }),
    );
    expect(check(k, 'apdex')).toMatchObject({
      observed: 0.9286,
      actual: wilsonBounds(6.5, 7)?.upper,
    });
  });

  test('rule order, observed values and n of the checks', () => {
    const k = one(
      {
        durations: [
          [18, 100],
          [2, 1000],
        ],
        errors: 1,
        other: 1,
      },
      { t: 500 },
    );
    expect(k.checks.map((c) => [c.rule, c.n, c.observed])).toEqual([
      ['median', 20, null],
      ['percentile', 20, null],
      ['apdex', 20, 0.95],
      ['wilson', 20, 0.1],
      ['errors', 22, 0.0455],
    ]);
  });

  test('the percentile rule compares checks.time.percentile.level', () => {
    const cfg = config({ checks: { time: { percentile: { level: 'p90' } } } });
    const e = evaluate(
      aggregates(
        {
          [KEY]: {
            durations: [
              [18, 100],
              [2, 1000],
            ],
          },
        },
        'p90',
      ),
      files(),
      cfg,
      options(),
    );
    const c = e.perKey.api[KEY]?.checks.find((x) => x.rule === 'percentile');
    expect(c?.actual).toBe(190);
  });
});

describe('limits and results (09, chapter 5)', () => {
  test('09-AC-11 t null or default thresholds give no apdex and wilson checks', () => {
    const rules = (k: EvaluatedKey) => k.checks.map((c) => c.rule);
    const nullT = one({ durations: [[20, 100]] }, { t: null, percentile: 900 });
    expect(nullT.limits).toMatchObject({ t: null, minApdex: null, maxWilson: null });
    expect(rules(nullT)).toEqual(['median', 'percentile', 'errors']);
    const byDefault = one({ durations: [[20, 100]] });
    expect(byDefault.thresholdSource).toBe('default');
    expect(rules(byDefault)).toEqual(['median', 'percentile', 'errors']);
  });

  test('09-AC-11 a hand-written entry without median gets median from the defaults', () => {
    const k = one({ durations: [[20, 100]] }, { percentile: 900 });
    expect(k.thresholdSource).toBe('file');
    expect(k.limits.median).toBe(2000);
    expect(check(k, 'median')?.limit).toBe(2000);
  });

  test('09-AC-19 entry { t: 400 } gets minApdex and maxWilson from checks.slowShare.*.limit', () => {
    const cfg = config({
      checks: { slowShare: { apdex: { limit: { api: 0.8 } }, wilson: { limit: { api: 0.07 } } } },
    });
    const k = one({ durations: [[20, 100]] }, { t: 400 }, cfg);
    expect(k.limits).toEqual({
      t: 400,
      median: 2000,
      percentile: 2000,
      p99: 4000,
      minApdex: 0.8,
      maxWilson: 0.07,
      maxErrorRate: 0.05,
    });
    expect(check(k, 'apdex')?.limit).toBe(0.8);
    expect(check(k, 'wilson')?.limit).toBe(0.07);
  });

  test('02-AC-14 hand-written entries are completed from the config', () => {
    const handSet = config({
      checks: { errors: { limit: { api: 0.1 } }, time: { p99: { limit: { api: 5000 } } } },
    });
    expect(one({ durations: [[20, 100]] }, { t: 400, percentile: 900 }, handSet).limits).toEqual({
      t: 400,
      median: 2000,
      percentile: 900,
      p99: 5000,
      minApdex: 0.85,
      maxWilson: 0.05,
      maxErrorRate: 0.1,
    });
    expect(one({ durations: [[20, 100]] }, { percentile: 900 }).limits).toMatchObject({
      t: null,
      minApdex: null,
      maxWilson: null,
    });
  });

  test('an explicit null minApdex with t set turns off only the apdex rule', () => {
    const k = one({ durations: [[20, 100]] }, { t: 400, minApdex: null });
    expect(k.limits.minApdex).toBeNull();
    expect(k.checks.map((c) => c.rule)).toEqual(['median', 'percentile', 'wilson', 'errors']);
  });

  test('reasons of not-evaluated keys: too-few-samples and no-rules', () => {
    const few = one({ durations: [[2, 100]] }, { percentile: 900 });
    expect(few).toMatchObject({
      result: 'not-evaluated',
      reason: 'too-few-samples',
      thresholdSource: 'file',
      checks: [],
    });
    const cfg = config({
      checks: {
        time: {
          median: { enabled: false },
          percentile: { enabled: false },
          p99: { enabled: false },
        },
        errors: { enabled: false },
      },
    });
    const none = one({ durations: [[50, 100]] }, undefined, cfg);
    expect(none).toMatchObject({ result: 'not-evaluated', reason: 'no-rules', checks: [] });
    expect(none.limits.median).toBe(2000);
  });

  test('a key with only 404 samples is evaluated by the errors rule only and passes', () => {
    const k = one({ other: 5 });
    expect(k.result).toBe('pass');
    expect(k.checks.map((c) => [c.rule, c.actual])).toEqual([['errors', 0]]);
  });

  test('09-AC-05 invalid api file: api keys thresholds-error, status error', () => {
    const e = evaluate(
      aggregates({ [KEY]: { durations: [[20, 9000]] } }),
      files(invalid('api')),
      config(),
      options(),
    );
    expect(e.perKey.api[KEY]).toEqual({
      result: 'not-evaluated',
      reason: 'thresholds-error',
      thresholdSource: 'default',
      limits: {
        t: null,
        median: 2000,
        percentile: 2000,
        p99: 4000,
        minApdex: null,
        maxWilson: null,
        maxErrorRate: 0.05,
      },
      checks: [],
      muted: null,
    });
    expect(e.status).toBe('error');
    expect(e.toolErrors).toEqual([
      {
        code: 'SCHEMA_INVALID_JSON',
        message: 'pw-perf-thresholds.json: not valid JSON',
        hint: expect.any(String),
      },
    ]);
    expect(e.thresholdFiles.map((f) => [f.kind, f.status, f.unseenKeys])).toEqual([
      ['api', 'invalid', []],
    ]);
  });
});

describe('counters (09, chapter 7)', () => {
  test('09-AC-06 invariants of 09-REQ-18 hold in every golden case', () => {
    for (const c of loadEvaluateCases()) {
      for (const counts of Object.values(runGoldenCase(c).evaluation.counts)) {
        expect(counts.keys, c.name).toBe(
          counts.fromFile + counts.fromDefaults + counts.notEvaluated,
        );
        expect(counts.fileEntriesNotEvaluated).toBeLessThanOrEqual(counts.tooFewSamples);
        expect(counts.tooFewSamples).toBeLessThanOrEqual(counts.notEvaluated);
        expect(counts.medianOnly).toBeLessThanOrEqual(counts.fromFile + counts.fromDefaults);
        expect(counts.blockingViolations).toBeLessThanOrEqual(counts.violations);
        expect(counts.violations).toBeLessThanOrEqual(counts.fromFile + counts.fromDefaults);
      }
    }
  });

  test('02-AC-08 counters match the per-key data', () => {
    const e = evaluate(
      aggregates({
        'GET /a': { durations: [[20, 1500]] },
        'GET /b': { durations: [[6, 100]] },
        'GET /c': { durations: [[2, 100]] },
        'GET /d': { durations: [[3, 100]] },
        'GET /e': { durations: [[30, 3000]] },
      }),
      files(
        loaded('api', {
          'GET /a': { percentile: 1400 },
          'GET /c': { percentile: 1400 },
          'GET /gone': { percentile: 1400 },
          'GET /locked': { percentile: 1400, locked: true, note: 'kept' },
          'GET /muted': { gate: 'warn', note: 'n', until: '2026-12-31' },
        }),
      ),
      config(),
      options(),
    );
    expect(e.counts.api).toEqual({
      keys: 5,
      fromFile: 1,
      fromDefaults: 2,
      notEvaluated: 2,
      tooFewSamples: 2,
      fileEntriesNotEvaluated: 1,
      medianOnly: 1,
      unseenThresholdEntries: 3,
      violations: 2,
      blockingViolations: 2,
      muted: 0,
    });
    expect(codes(e)).toEqual(['THRESHOLDS_UNSEEN_ENTRIES', 'THRESHOLDS_ENTRIES_NOT_EVALUATED']);
  });

  test('09-AC-17 unseen entries: sorted, locked included, one warning, n = 0 is seen', () => {
    const e = evaluate(
      aggregates({ 'GET /seen': { errors: 2 } }),
      files(
        loaded('api', {
          'GET /z': { percentile: 1 },
          'GET /seen': { percentile: 1 },
          'GET /a': { percentile: 1, locked: true, note: 'pinned' },
          'GET /m': { percentile: 1 },
        }),
      ),
      config(),
      options(),
    );
    expect(e.thresholdFiles[0]?.unseenKeys).toEqual(['GET /a', 'GET /m', 'GET /z']);
    expect(e.counts.api.unseenThresholdEntries).toBe(3);
    expect(codes(e).filter((c) => c === 'THRESHOLDS_UNSEEN_ENTRIES')).toHaveLength(1);
    expect(e.warnings[0]?.message).toBe(
      '3 entries in pw-perf-thresholds.json were not seen in this run.',
    );
  });

  test('unseen entries count 0 for missing and invalid files', () => {
    const e = evaluate(aggregates({}), files(missing('api')), config(), options());
    expect(e.counts.api.unseenThresholdEntries).toBe(0);
    const broken = evaluate(aggregates({}), files(invalid('api')), config(), options());
    expect(broken.counts.api.unseenThresholdEntries).toBe(0);
  });

  test('a run without aggregates passes with EVAL_NO_SAMPLES', () => {
    const e = evaluate(aggregates({}), files(), config(), options());
    expect(e.status).toBe('passed');
    expect(codes(e)).toEqual(['EVAL_NO_SAMPLES']);
  });
});

describe('thresholds files (09, chapter 4)', () => {
  test('09-AC-16 env qa with only the file without label: missing, defaults, hint names it', () => {
    const e = evaluate(
      aggregates({ [KEY]: { durations: [[20, 100]] } }),
      files(missing('api', true, 'qa')),
      config(),
      options({ env: 'qa' }),
    );
    expect(e.perKey.api[KEY]?.thresholdSource).toBe('default');
    expect(e.perKey.api[KEY]?.result).toBe('pass');
    expect(codes(e)).toEqual(['THRESHOLDS_FILE_MISSING']);
    expect(e.warnings[0]?.message).toContain('pw-perf-thresholds.qa.json');
    expect(e.warnings[0]?.hint).toContain('npx pw-perf thresholds');
    expect(e.warnings[0]?.hint).toContain('pw-perf-thresholds.json exists');
    expect(e.thresholdFiles.map((f) => [f.status, f.generated])).toEqual([['missing', null]]);
  });

  test('09-AC-23 THRESHOLDS_FILE_MISSING only for kinds with keys in the run', () => {
    const apiOnly = evaluate(
      aggregates({ [KEY]: { durations: [[20, 100]] } }),
      files(missing('api')),
      config(),
      options(),
    );
    expect(codes(apiOnly)).toEqual(['THRESHOLDS_FILE_MISSING']);
    expect(apiOnly.warnings[0]?.message).toContain('pw-perf-thresholds.json');
    expect(apiOnly.warnings[0]?.hint).not.toContain('exists');
    // No keys at all: EVAL_NO_SAMPLES says it all.
    const none = evaluate(aggregates({}), files(missing('api')), config(), options());
    expect(codes(none)).toEqual(['EVAL_NO_SAMPLES']);
  });

  const generated: Generated = {
    tool: { name: 'playwright-performance-regression', version: '0.1.0' },
    env: 'qa',
    sourceRunId: 'r1',
    sourceRunStartedAt: '2026-11-17T10:00:00.000Z',
    sourceSampleCount: 100,
    evaluatedPercentile: 'p95',
    derivation: {
      t: { min: 500, max: 2000, medianFactor: 2 },
      smallSampleN: 20,
      margins: { median: {}, percentile: {}, p99: {}, apdex: {}, wilson: {}, errors: {} },
    },
    browsers: ['chromium'],
    playwrightVersion: '1.57.0',
    host: { ...SOURCE.host },
    normalization: SOURCE.normalization,
  };

  function withGenerated(g: Generated | null, env: string | null = 'qa'): Evaluation {
    return evaluate(
      aggregates({ [KEY]: { durations: [[20, 1500]] } }),
      files(loaded('api', { [KEY]: { percentile: 1400 } }, g)),
      config(),
      options({ env }),
    );
  }

  test('a matching generated block gives no warnings and is copied to thresholdFiles', () => {
    const e = withGenerated(generated);
    expect(codes(e)).toEqual([]);
    expect(e.thresholdFiles[0]?.generated).toEqual(generated);
  });

  test('09-AC-18 percentile and env mismatches warn and the evaluation goes on', () => {
    const e = withGenerated({ ...generated, evaluatedPercentile: 'p90', env: 'staging' });
    expect(codes(e)).toEqual(['EVAL_PERCENTILE_MISMATCH', 'THRESHOLDS_ENV_MISMATCH']);
    expect(e.status).toBe('failed');
    expect(e.perKey.api[KEY]?.checks.find((c) => c.rule === 'percentile')?.limit).toBe(1400);
    expect(codes(withGenerated(null))).toEqual([]);
  });

  test('09-AC-13 browsers, host or normalization differences give one source mismatch warning', () => {
    const e = withGenerated({
      ...generated,
      browsers: ['firefox'],
      host: { ...generated.host, cpuCount: 8 },
      normalization: 'ffffffffffffff',
    });
    expect(codes(e)).toEqual(['THRESHOLDS_SOURCE_MISMATCH']);
    const message = e.warnings[0]?.message ?? '';
    expect(message).toContain('browsers firefox / chromium');
    expect(message).toContain('host.cpuCount 8 / 4');
    expect(message).toContain('normalization ffffffffffffff / 0a3f9c21d47b6e');
    expect(e.warnings[0]?.hint).toContain('same infrastructure');
    expect(e.warnings[0]?.hint).toContain('derive thresholds again');
    expect(e.status).toBe('failed');
  });

  test('09-AC-13 a Playwright patch version difference gives no warning, minor does', () => {
    expect(codes(withGenerated({ ...generated, playwrightVersion: '1.57.2' }))).toEqual([]);
    const minor = withGenerated({ ...generated, playwrightVersion: '1.58.0' });
    expect(codes(minor)).toEqual(['THRESHOLDS_SOURCE_MISMATCH']);
    expect(minor.warnings[0]?.message).toContain('playwrightVersion 1.58.0 / 1.57.0');
  });

  test('a migrated file warns THRESHOLDS_FILE_OUTDATED', () => {
    const file = loaded('api');
    const e = evaluate(
      aggregates({}),
      files({ ...file, migratedFrom: 0 } as typeof file),
      config(),
      options(),
    );
    expect(codes(e)).toContain('THRESHOLDS_FILE_OUTDATED');
  });
});

describe('muting (09, chapter 6.5)', () => {
  const muted = (until: string) => ({
    percentile: 1400,
    gate: 'warn' as const,
    note: 'Tracked in backlog',
    until,
  });
  function run(until: string, startedAt = '2026-11-18T23:59:59.000Z'): Evaluation {
    return evaluate(
      aggregates({ [KEY]: { durations: [[20, 3000]] }, 'GET /other': { durations: [[20, 100]] } }),
      files(loaded('api', { [KEY]: muted(until) })),
      config(),
      options({ startedAt }),
    );
  }

  test('09-AC-14 muted until the run date: violation above 2x does not block; warned', () => {
    const e = run('2026-11-18');
    const k = e.perKey.api[KEY];
    expect(k?.muted).toEqual({ until: '2026-11-18', note: 'Tracked in backlog', expired: false });
    expect(
      k?.checks.filter((c) => !c.passed).map((c) => [c.rule, c.hardLimitExceeded, c.blocking]),
    ).toEqual([
      ['median', false, false],
      ['percentile', true, false],
    ]);
    expect(e.status).toBe('warned');
    expect(codes(e)).toEqual(['THRESHOLDS_MUTED', 'THRESHOLDS_MUTE_EXPIRING']);
  });

  test('09-AC-14 until one day before the run: expired, blocks, THRESHOLDS_MUTE_EXPIRED', () => {
    const e = run('2026-11-17', '2026-11-18T00:00:00.000Z');
    const k = e.perKey.api[KEY];
    expect(k?.muted?.expired).toBe(true);
    expect(k?.checks.filter((c) => !c.passed).every((c) => c.blocking)).toBe(true);
    expect(e.status).toBe('failed');
    expect(e.counts.api.muted).toBe(0);
    expect(codes(e)).toEqual(['THRESHOLDS_MUTE_EXPIRED']);
    expect(e.warnings[0]?.message).toContain(`api ${KEY} (until 2026-11-17)`);
  });

  test('09-AC-15 until 7 days after the run warns expiring, 8 days does not', () => {
    const seven = run('2026-11-25');
    expect(codes(seven)).toEqual(['THRESHOLDS_MUTED', 'THRESHOLDS_MUTE_EXPIRING']);
    expect(codes(run('2026-11-26'))).toEqual(['THRESHOLDS_MUTED']);
  });

  test('09-AC-15 counter muted and THRESHOLDS_MUTED match the active mutings', () => {
    const e = evaluate(
      aggregates({
        'GET /a': { durations: [[20, 100]] },
        'GET /b': { durations: [[2, 100]] },
        'GET /c': { durations: [[20, 100]] },
      }),
      files(
        loaded('api', {
          'GET /a': muted('2027-01-31'),
          'GET /b': muted('2027-01-31'),
          'GET /c': muted('2026-01-01'),
        }),
      ),
      config(),
      options(),
    );
    expect(e.counts.api.muted).toBe(2);
    expect(e.warnings.find((w) => w.code === 'THRESHOLDS_MUTED')?.message).toBe(
      '2 keys are muted; their violations do not block.',
    );
  });

  test('an entry with muting only uses config limits with source file', () => {
    const e = evaluate(
      aggregates({ [KEY]: { durations: [[20, 100]] } }),
      files(loaded('api', { [KEY]: { gate: 'warn', note: 'n', until: '2026-12-31' } })),
      config(),
      options(),
    );
    expect(e.perKey.api[KEY]).toMatchObject({
      thresholdSource: 'file',
      limits: { t: null, median: 2000 },
      muted: { expired: false },
    });
  });

  test('the reference date is startedAt, so evaluating again gives the same result', () => {
    expect(run('2026-11-18', '2026-11-18T23:59:59.999Z')).toEqual(
      run('2026-11-18', '2026-11-18T23:59:59.999Z'),
    );
    expect(run('2026-11-18', '2026-11-19T00:00:00.000Z').perKey.api[KEY]?.muted?.expired).toBe(
      true,
    );
  });
});

describe('run report', () => {
  test('02-AC-08 the evaluation plugs into buildRunReport and gives a valid report', () => {
    const found = loadCases('run-report').find(
      (c) => c.dir === 'valid' && c.file === 'full-run.json',
    );
    const base = structuredClone(found?.input) as RunReport;
    const aggs = aggregates({ [KEY]: { durations: [[20, 1500]] }, 'GET /b': { errors: 5 } });
    const e = evaluate(
      aggs,
      files(
        loaded('api', {
          [KEY]: { percentile: 1400, gate: 'warn', note: 'n', until: '2026-12-31' },
          'GET /gone': {},
        }),
      ),
      config(),
      options(),
    );
    const report = buildRunReport({
      meta: base,
      config: base.config,
      normalization: base.normalization,
      stepNormalization: null,
      runConditions: base.runConditions,
      tests: base.tests,
      aggregates: { steps: {}, ...aggs, origins: [], testBreakdown: NO_TEST_BREAKDOWN },
      evaluation: e,
      warnings: e.warnings,
      toolErrors: e.toolErrors,
    });
    const parsed = parseRunReport(stringifyStable(report), 'report.json');
    expect(parsed.ok).toBe(true);
    expect(report.evaluation).toEqual({ status: e.status, gateEnabled: true, counts: e.counts });
    // buildRunReport adds usage to the checks of the evaluation (11-REQ-30).
    expect(report.endpoints[KEY]?.evaluation).toEqual({
      ...e.perKey.api[KEY],
      checks: e.perKey.api[KEY]?.checks.map((c) => ({ ...c, usage: checkUsage(c) })),
    });
  });
});

describe('determinism', () => {
  test('evaluate is deterministic and does not modify its input', () => {
    const input = aggregates({ [KEY]: { durations: [[20, 1500]] } });
    const thresholds = files(loaded('api', { [KEY]: { percentile: 1400 } }));
    const before = structuredClone({ input, thresholds });
    const a = evaluate(input, thresholds, config(), options());
    const b = evaluate(input, thresholds, config(), options());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect({ input, thresholds }).toEqual(before);
  });
});
