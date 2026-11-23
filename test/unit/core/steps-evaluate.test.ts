// Evaluation and thresholds derivation of step keys (09-REQ-31, 10-REQ-22).
import { describe, expect, test } from 'vitest';
import { evaluate } from '../../../src/core/evaluate/index.ts';
import { deriveThresholds, diffThresholds } from '../../../src/core/thresholds/index.ts';
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
const STEPS_OFF = config({ measure: { steps: false } });

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

describe('09-AC-32 thresholds mode', () => {
  test('no THRESHOLDS_FILE_MISSING while deriving; two in test mode', () => {
    const run = (mode: 'test' | 'thresholds') =>
      evaluate(
        { endpoints: API, steps: STEP },
        files(missing('api'), missing('step')),
        STEPS_ON,
        options({ mode }),
      ).warnings.filter((w) => w.code === 'THRESHOLDS_FILE_MISSING');
    expect(run('thresholds')).toEqual([]);
    expect(run('test')).toHaveLength(2);
  });
});

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

describe('09-AC-35 empty thresholds files (04-REQ-75)', () => {
  test('test mode: THRESHOLDS_FILE_EMPTY for a kind with keys, the derive hint, default limits', () => {
    const run = (mode: 'test' | 'thresholds', step = STEP) =>
      evaluate(
        { endpoints: API, steps: step },
        files(loaded('api'), loaded('step')),
        STEPS_ON,
        options({ mode }),
      );
    const e = run('test');
    expect(e.warnings.map((w) => w.code)).toEqual([
      'THRESHOLDS_FILE_EMPTY',
      'THRESHOLDS_FILE_EMPTY',
    ]);
    expect(e.warnings[0]).toEqual({
      code: 'THRESHOLDS_FILE_EMPTY',
      message:
        'Thresholds file pw-perf-thresholds.json has no entries; endpoint keys are evaluated with default thresholds.',
      hint: 'Derive thresholds with `PW_PERF_MODE=thresholds <your test command>`.',
    });
    expect(e.perKey.api['GET /api/a']?.thresholdSource).toBe('default');
    // A kind without keys in the run needs no thresholds yet (09-D-17).
    expect(run('test', {}).warnings.map((w) => w.message)).toEqual([
      'Thresholds file pw-perf-thresholds.json has no entries; endpoint keys are evaluated with default thresholds.',
    ]);
    expect(run('thresholds').warnings.map((w) => w.code)).not.toContain('THRESHOLDS_FILE_EMPTY');
  });
});

describe('10-AC-22 derivation over the empty files of the wizard', () => {
  const report = runReport({ endpoints: { 'GET /api/a': { durations: [[30, 100]] } } });
  const empty = (kind: 'api' | 'step') =>
    loadedFile({ schemaVersion: 2, kind, generated: null, entries: {} });

  test('writes the same entries as a first derivation, updated, without THRESHOLDS_MANUAL_FILE', () => {
    const first = deriveThresholds(report, STEPS_ON, existing(), deriveOptions());
    const before = existing(empty('api'), empty('step'));
    const result = deriveThresholds(report, STEPS_ON, before, deriveOptions());
    if (!first.ok || !result.ok) throw new Error('refused');
    expect(result.value.warnings.map((w) => w.code)).not.toContain('THRESHOLDS_MANUAL_FILE');
    const api = result.value.files.find((f) => f.kind === 'api');
    expect(api?.changed).toBe(true);
    expect(api?.content).toEqual(first.value.files.find((f) => f.kind === 'api')?.content);
    if (api === undefined) throw new Error('no api');
    expect(diffThresholds(before.api, api, report, STEPS_ON).fileStatus).toBe('updated');
    // No step keys: the empty step file stays as it is (10-REQ-14).
    expect(result.value.files.find((f) => f.kind === 'step')?.changed).toBe(false);
  });
});
