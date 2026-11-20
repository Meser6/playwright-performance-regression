// Evaluation and thresholds derivation of step keys (09-REQ-31, 10-REQ-22).
import { describe, expect, test } from 'vitest';
import { evaluate } from '../../../src/core/evaluate/index.ts';
import { deriveThresholds } from '../../../src/core/thresholds/index.ts';
import type { AggregateStats, StepAggregateStats } from '../../../src/core/types/index.ts';
import {
  aggregates,
  config,
  files,
  invalid,
  loaded,
  missing,
  options,
} from './evaluate-helpers.ts';
import { deriveOptions, existing, loadedFile, runReport } from './thresholds-helpers.ts';

const STEPS_ON = config({ measure: { steps: true } });
const STEPS_OFF = config();

function steps(spec: Parameters<typeof aggregates>[0]): Record<string, StepAggregateStats> {
  return Object.fromEntries(
    Object.entries(aggregates(spec).endpoints).map(([key, a]: [string, AggregateStats]) => [
      key,
      { ...a, location: null, stepErrorsFromFailedTests: 0 },
    ]),
  );
}

const API = aggregates({ 'GET /api/a': { durations: [[30, 100]] } }).endpoints;
const STEP = steps({ 'login › submit': { durations: [[30, 3000]] } });

describe('09-AC-25 step keys', () => {
  test('without the step file: THRESHOLDS_FILE_MISSING for step and default limit.step', () => {
    const e = evaluate(
      { endpoints: API, steps: STEP },
      files(loaded('api'), missing('step')),
      STEPS_ON,
      options(),
    );
    const missingFor = e.warnings.filter((w) => w.code === 'THRESHOLDS_FILE_MISSING');
    expect(missingFor.map((w) => w.message)).toEqual([
      'Thresholds file pw-perf-thresholds.steps.json not found; step keys are evaluated with default thresholds.',
    ]);
    const login = e.perKey.step['login › submit'];
    expect(login?.thresholdSource).toBe('default');
    expect(login?.result).toBe('pass');
    expect(e.counts.step).toMatchObject({ keys: 1, fromDefaults: 1 });
  });

  test('a step entry with an exceeded median blocks', () => {
    const e = evaluate(
      { endpoints: API, steps: STEP },
      files(loaded('api'), loaded('step', { 'login › submit': { median: 1000 } })),
      STEPS_ON,
      options(),
    );
    expect(e.perKey.step['login › submit']?.result).toBe('fail');
    expect(e.status).toBe('failed');
    expect(e.thresholdFiles.map((f) => [f.kind, f.status])).toEqual([
      ['api', 'loaded'],
      ['step', 'loaded'],
    ]);
  });

  test('with measure.steps off the step file is ignored', () => {
    const e = evaluate(
      { endpoints: API, steps: {} },
      files(loaded('api'), invalid('step')),
      STEPS_OFF,
      options(),
    );
    expect(e.status).toBe('passed');
    expect(e.thresholdFiles.map((f) => f.kind)).toEqual(['api']);
    expect(e.toolErrors).toEqual([]);
  });
});

describe('09-AC-23 and 09-AC-05 per kind', () => {
  test('without step keys no THRESHOLDS_FILE_MISSING for step; a key with n = 0 gets it', () => {
    const none = evaluate(
      { endpoints: API, steps: {} },
      files(missing('api'), missing('step')),
      STEPS_ON,
      options(),
    );
    expect(none.warnings.filter((w) => w.code === 'THRESHOLDS_FILE_MISSING')).toHaveLength(1);
    const zero = evaluate(
      { endpoints: API, steps: steps({ pay: { errors: 2 } }) },
      files(missing('api'), missing('step')),
      STEPS_ON,
      options(),
    );
    expect(zero.warnings.filter((w) => w.code === 'THRESHOLDS_FILE_MISSING')).toHaveLength(2);
  });

  test('an invalid api file: api keys thresholds-error, step keys evaluated normally', () => {
    const e = evaluate(
      { endpoints: API, steps: STEP },
      files(invalid('api'), missing('step')),
      STEPS_ON,
      options(),
    );
    expect(e.status).toBe('error');
    expect(e.perKey.api['GET /api/a']?.reason).toBe('thresholds-error');
    expect(e.perKey.step['login › submit']?.result).toBe('pass');
  });
});

describe('10-AC-19 step thresholds file', () => {
  const report = runReport({
    endpoints: { 'GET /api/a': { durations: [[30, 100]] } },
    steps: { 'login › submit': { durations: [[30, 3000]] } },
    stepNormalization: '0123456789abcd',
  });

  test('derives pw-perf-thresholds.steps.json with T from t.step and the step fingerprint', () => {
    const result = deriveThresholds(report, STEPS_ON, existing(), deriveOptions());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const step = result.value.files.find((f) => f.kind === 'step');
    expect(step?.changed).toBe(true);
    expect(step?.content?.kind).toBe('step');
    expect(step?.content?.generated?.normalization).toBe('0123456789abcd');
    expect(step?.content?.generated?.derivation.t).toEqual({
      min: 1000,
      max: 10000,
      medianFactor: 2,
    });
    const entry = step?.content?.entries['login › submit'];
    expect(entry?.t).toBeGreaterThanOrEqual(1000);

    // Self-consistency: the same report with the derived file passes (10-REQ-05).
    if (step?.content == null) throw new Error('no content');
    const api = result.value.files.find((f) => f.kind === 'api')?.content;
    if (api == null) throw new Error('no api');
    const e = evaluate(
      { endpoints: report.endpoints, steps: report.steps },
      files(loadedFile(api), loadedFile(step.content)),
      STEPS_ON,
      options({ source: { ...options().source, stepNormalization: '0123456789abcd' } }),
    );
    expect(e.perKey.step['login › submit']?.result).toBe('pass');
  });

  test('a report with steps: {} leaves an existing step file unchanged and out of nothing', () => {
    const empty = runReport({ endpoints: { 'GET /api/a': { durations: [[30, 100]] } } });
    const before = existing(
      undefined,
      loadedFile({
        schemaVersion: 2,
        kind: 'step',
        generated: null,
        entries: { pay: { median: 900 } },
      }),
    );
    const result = deriveThresholds(empty, STEPS_ON, before, deriveOptions());
    if (!result.ok) throw new Error('refused');
    const step = result.value.files.find((f) => f.kind === 'step');
    expect(step?.changed).toBe(false);
    expect(result.value.warnings.map((w) => w.code)).not.toContain('THRESHOLDS_KIND_SKIPPED');
    const off = deriveThresholds(empty, STEPS_OFF, existing(), deriveOptions());
    if (!off.ok) throw new Error('refused');
    expect(off.value.files.map((f) => f.kind)).toEqual(['api']);
  });
});
