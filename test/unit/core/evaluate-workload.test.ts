// Evaluation of 1.1.0: the nonSuccess rule (09, chapter 5.5), the workload of a key (09,
// chapter 7a) and coldSamples in THRESHOLDS_SOURCE_MISMATCH (09-REQ-04).
import { describe, expect, test } from 'vitest';
import { evaluate } from '../../../src/core/evaluate/index.ts';
import type { AggregateStats, ThresholdsEntry } from '../../../src/core/types/index.ts';
import { aggregate, config, files, loaded, missing, options, SOURCE } from './evaluate-helpers.ts';
import type { AggregateSpec } from './evaluate-helpers.ts';
import { generated } from './thresholds-helpers.ts';

const KEY = 'GET /api/me';
const ENTRY: ThresholdsEntry = {
  t: 500,
  median: 220,
  percentile: 364,
  p99: 492,
  minApdex: 0.9,
  maxWilson: 0.1,
  maxErrorRate: 0.05,
  maxNonSuccessRate: 0.05,
};
const FAST_401: AggregateSpec = { other: 20, otherStatus: '401' };

function run(
  spec: AggregateSpec | AggregateStats,
  entry: ThresholdsEntry | null = ENTRY,
  opts: Partial<Parameters<typeof options>[0]> = {},
  cfg = config(),
) {
  const stats = 'count' in spec ? spec : aggregate(spec);
  return evaluate(
    { endpoints: { [KEY]: stats } },
    files(entry === null ? missing('api') : loaded('api', { [KEY]: entry })),
    cfg,
    options(opts),
  );
}

const codes = (e: ReturnType<typeof run>): string[] => e.warnings.map((w) => w.code);

describe('rule nonSuccess (09-REQ-38, 09-REQ-39)', () => {
  test('09-AC-37 G11: an entry and 20 × 401 fail nonSuccess and block; a higher limit from the source run passes', () => {
    const e = run(FAST_401);
    const key = e.perKey.api[KEY];
    expect(key?.checks.map((c) => c.rule)).toEqual(['errors', 'nonSuccess']);
    expect(key?.checks.find((c) => c.rule === 'nonSuccess')).toMatchObject({
      n: 20,
      actual: 0.8389,
      observed: 1,
      limit: 0.05,
      passed: false,
      blocking: true,
      hardLimitExceeded: false,
    });
    expect(key?.checks.find((c) => c.rule === 'errors')?.passed).toBe(true);
    expect(e.status).toBe('failed');
    // A source run with 15 × 200 and 5 × 404 gives maxNonSuccessRate 0.395 (10-REQ-25); the same
    // share in this run passes. A key with only 404s gets no entry at all (10-REQ-02).
    const expected404 = run(
      { durations: [[15, 120]], other: 5 },
      { ...ENTRY, maxNonSuccessRate: 0.395 },
    );
    expect(expected404.perKey.api[KEY]?.checks.find((c) => c.rule === 'nonSuccess')?.passed).toBe(
      true,
    );
    expect(expected404.status).toBe('passed');
  });

  test('09-AC-38 default thresholds run no nonSuccess check unless checks.nonSuccess.limit.api is set', () => {
    const none = run(FAST_401, null);
    expect(none.perKey.api[KEY]?.checks.map((c) => c.rule)).toEqual(['errors']);
    expect(none.perKey.api[KEY]?.limits.maxNonSuccessRate).toBeNull();
    const withLimit = run(
      FAST_401,
      null,
      {},
      config({ checks: { nonSuccess: { limit: { api: 0.1 } } } }),
    );
    const check = withLimit.perKey.api[KEY]?.checks.find((c) => c.rule === 'nonSuccess');
    expect(check).toMatchObject({ limit: 0.1, passed: false });
    // An entry without maxNonSuccessRate (a migrated version 2 file) takes the config value.
    const { maxNonSuccessRate: _m, ...v2Entry } = ENTRY;
    expect(run(FAST_401, v2Entry).perKey.api[KEY]?.limits.maxNonSuccessRate).toBeNull();
    expect(
      run(FAST_401, v2Entry, {}, config({ checks: { nonSuccess: { limit: { api: 0.2 } } } })).perKey
        .api[KEY]?.limits.maxNonSuccessRate,
    ).toBe(0.2);
    // The rule off, or below its minSamples, does not run.
    const off = run(FAST_401, ENTRY, {}, config({ checks: { nonSuccess: { enabled: false } } }));
    expect(off.perKey.api[KEY]?.checks.map((c) => c.rule)).toEqual(['errors']);
    expect(run({ other: 4, otherStatus: '401' }).perKey.api[KEY]?.result).toBe('not-evaluated');
  });

  test('09-AC-39 THRESHOLDS_ENTRY_NOT_TIMED names the key and its statuses; not in thresholds mode or without an entry', () => {
    const e = run(FAST_401);
    const warning = e.warnings.find((w) => w.code === 'THRESHOLDS_ENTRY_NOT_TIMED');
    expect(warning?.message).toBe(
      `1 endpoint key with thresholds was not timed because its responses were not successful: ${KEY} (20 × 401).`,
    );
    expect(codes(run(FAST_401, ENTRY, { mode: 'thresholds' }))).not.toContain(
      'THRESHOLDS_ENTRY_NOT_TIMED',
    );
    expect(codes(run(FAST_401, null))).not.toContain('THRESHOLDS_ENTRY_NOT_TIMED');
    // Timed often enough, or called too rarely: no warning.
    expect(codes(run({ durations: [[5, 100]], other: 15, otherStatus: '403' }))).not.toContain(
      'THRESHOLDS_ENTRY_NOT_TIMED',
    );
    expect(codes(run({ other: 4, otherStatus: '401' }))).not.toContain(
      'THRESHOLDS_ENTRY_NOT_TIMED',
    );
    // Mixed statuses, most samples first.
    const mixed = run({ durations: [[3, 100]], other: 12, otherStatus: '403' });
    expect(mixed.warnings.find((w) => w.code === 'THRESHOLDS_ENTRY_NOT_TIMED')?.message).toContain(
      `${KEY} (12 × 403, 3 × 200)`,
    );
  });
});

describe('workload (09-REQ-40, 09-REQ-41)', () => {
  const sourced: ThresholdsEntry = {
    ...ENTRY,
    source: { count: 40, successCount: 40, passes: 10, share: 0.5 },
  };

  test('09-AC-40 12 samples in 5 passes vs 40 in 10: ×0.6, not shifted; 2 samples: ×0.1, shifted and warned', () => {
    const twelve = run({ durations: [[12, 100]] }, sourced, { passes: 5 });
    expect(twelve.perKey.api[KEY]?.workload).toEqual({
      base: { count: 40, successCount: 40, passes: 10, workers: 1, share: 0.5 },
      now: { count: 12, successCount: 12, passes: 5, workers: 1, share: 1 },
      perPassRatio: 0.6,
      shifted: false,
    });
    expect(codes(twelve)).not.toContain('THRESHOLDS_WORKLOAD_SHIFT');

    const two = run({ durations: [[2, 100]] }, sourced, { passes: 5 });
    expect(two.perKey.api[KEY]?.workload).toMatchObject({ perPassRatio: 0.1, shifted: true });
    const warning = two.warnings.find((w) => w.code === 'THRESHOLDS_WORKLOAD_SHIFT');
    expect(warning?.message).toBe(
      `1 endpoint key gets a different share of the traffic than in the thresholds run: ${KEY} 4.0 → 0.4 samples per pass (×0.10).`,
    );
    // An entry without a source block (a migrated version 2 file) has no workload.
    expect(
      run({ durations: [[2, 100]] }, ENTRY, { passes: 5 }).perKey.api[KEY]?.workload,
    ).toBeNull();
    expect(run({ durations: [[2, 100]] }, null).perKey.api[KEY]?.workload).toBeNull();
  });

  test('09-AC-43 a shifted key with samples from failed tests names the retries in the hint', () => {
    const plain = run({ durations: [[2, 100]] }, sourced, { passes: 5 });
    const hint = plain.warnings.find((w) => w.code === 'THRESHOLDS_WORKLOAD_SHIFT')?.hint ?? '';
    expect(hint).toMatch(/^A change of the tests or fixtures/u);
    const retried = run(
      { ...aggregate({ durations: [[60, 100]] }), fromFailedTests: 40 },
      sourced,
      { passes: 5 },
    );
    const warning = retried.warnings.find((w) => w.code === 'THRESHOLDS_WORKLOAD_SHIFT');
    expect(warning?.hint).toMatch(
      /^Retries of failed tests add samples: 1 of these keys has samples from failed tests; fix the failures first\. A change of the tests/u,
    );
  });

  test('the factor comes from thresholds.workloadShift.factor; null turns it off; thresholds mode does not warn', () => {
    const off = run(
      { durations: [[2, 100]] },
      sourced,
      { passes: 5 },
      config({ thresholds: { workloadShift: { factor: null } } }),
    );
    expect(off.perKey.api[KEY]?.workload?.shifted).toBe(false);
    expect(codes(off)).not.toContain('THRESHOLDS_WORKLOAD_SHIFT');
    const wide = run(
      { durations: [[2, 100]] },
      sourced,
      { passes: 5 },
      config({ thresholds: { workloadShift: { factor: 20 } } }),
    );
    expect(wide.perKey.api[KEY]?.workload?.shifted).toBe(false);
    // Twice as many samples per pass is a shift too; fewer than 5 samples on both sides is not.
    expect(
      run({ durations: [[40, 100]] }, sourced, { passes: 5 }).perKey.api[KEY]?.workload,
    ).toMatchObject({ perPassRatio: 2, shifted: true });
    const small: ThresholdsEntry = {
      ...ENTRY,
      source: { count: 4, successCount: 4, passes: 10, share: 0.5 },
    };
    expect(
      run({ durations: [[1, 100]] }, small, { passes: 10 }).perKey.api[KEY]?.workload,
    ).toMatchObject({ perPassRatio: 0.25, shifted: false });
    expect(
      codes(run({ durations: [[2, 100]] }, sourced, { passes: 5, mode: 'thresholds' })),
    ).not.toContain('THRESHOLDS_WORKLOAD_SHIFT');
  });
});

describe('coldSamples in THRESHOLDS_SOURCE_MISMATCH (09-REQ-04)', () => {
  const file = (gen: ReturnType<typeof generated>) => files(loaded('api', { [KEY]: ENTRY }, gen));
  const source = { ...SOURCE, browsers: ['chromium'] };

  test('a different coldSamples is listed; a file without the field compares nothing', () => {
    const e = evaluate(
      { endpoints: { [KEY]: aggregate({ durations: [[20, 100]] }) } },
      file(generated({ coldSamples: 0 })),
      config(),
      options({ source: { ...source, coldSamples: 1 } }),
    );
    const warning = e.warnings.find((w) => w.code === 'THRESHOLDS_SOURCE_MISMATCH');
    expect(warning?.message).toContain('coldSamples 0 / 1');
    expect(warning?.hint).toContain('measure.coldSamples');
    const { coldSamples: _c, ...old } = generated();
    const fromV2 = evaluate(
      { endpoints: { [KEY]: aggregate({ durations: [[20, 100]] }) } },
      file(old),
      config(),
      options({ source: { ...source, coldSamples: 1 } }),
    );
    expect(codes(fromV2 as ReturnType<typeof run>)).not.toContain('THRESHOLDS_SOURCE_MISMATCH');
  });
});
