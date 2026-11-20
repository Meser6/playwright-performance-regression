import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { evaluate } from '../../../src/core/evaluate/index.ts';
import { stringifyStable } from '../../../src/core/format/index.ts';
import { parseThresholdsFile } from '../../../src/core/schema/index.ts';
import { wilsonBounds } from '../../../src/core/stats/index.ts';
import {
  ERR_SELF_GAP,
  WILSON_SELF_GAP,
  deriveEntry,
  deriveThresholds,
  entrySelfConsistent,
} from '../../../src/core/thresholds/index.ts';
import type { DerivedThresholds } from '../../../src/core/thresholds/index.ts';
import type {
  Issue,
  Kind,
  RunReport,
  ThresholdsEntry,
  ThresholdsFile,
} from '../../../src/core/types/index.ts';
import { GOLDEN_DIR } from '../../contract/golden.ts';
import { options } from './evaluate-helpers.ts';
import {
  cfg,
  deriveOptions,
  existing,
  file,
  generated,
  loadedFile,
  reportAggregate,
  runReport,
} from './thresholds-helpers.ts';
import type { ReportAggregateSpec, ReportSpec } from './thresholds-helpers.ts';
import type { LoadedThresholds } from '../../../src/core/evaluate/index.ts';
import type { ResolvedConfig } from '../../../src/core/config/index.ts';

const KEY = 'GET /api/tickets';

/** First golden example of 10, 5.1. */
const EXAMPLE_1: ReportAggregateSpec = {
  durations: [
    [199, 120],
    [1, 600],
  ],
  percentiles: { p50: 120, p90: 210, p95: 260, p99: 410 },
};

/** Second golden example of 10, 5.1: N = 12 with one error 500, so n = 11 successes. */
const EXAMPLE_2: ReportAggregateSpec = {
  durations: [[11, 2600]],
  errors: 1,
  percentiles: { p50: 2600, p90: 3900, p95: 4100, p99: 4300 },
};

function derive(
  spec: ReportSpec,
  files: LoadedThresholds = existing(),
  config: ResolvedConfig = cfg(),
  prune = false,
): DerivedThresholds {
  const result = deriveThresholds(runReport(spec), config, files, deriveOptions({ prune }));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function refused(report: RunReport, files: LoadedThresholds = existing(), prune = false): Issue[] {
  const result = deriveThresholds(report, cfg(), files, deriveOptions({ prune }));
  if (result.ok) throw new Error('expected a refusal');
  return result.issues;
}

function content(d: DerivedThresholds, kind: Kind = 'api'): ThresholdsFile {
  const f = d.files.find((x) => x.kind === kind)?.content;
  if (f === null || f === undefined) throw new Error(`${kind} not written`);
  return f;
}

function entryOf(d: DerivedThresholds, key = KEY, kind: Kind = 'api'): ThresholdsEntry {
  const e = content(d, kind).entries[key];
  if (e === undefined) throw new Error(`no entry ${key}`);
  return e;
}

function codes(d: DerivedThresholds): string[] {
  return d.warnings.map((w) => w.code);
}

/** Deterministic pseudo-random durations (LCG) for property-style checks. */
function lcg(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

function randomSpec(seed: number): ReportAggregateSpec {
  const next = lcg(seed);
  const n = 5 + Math.floor(next() * 300);
  const base = 1 + next() * 3000;
  const tail = next() * 5;
  const durations: [number, number][] = Array.from({ length: n }, () => [
    1,
    Math.round(base * (1 + tail * next() * next()) * 10) / 10,
  ]);
  return { durations, errors: Math.floor(next() * n * 0.3) };
}

describe('derived entry formulas (10, chapter 5)', () => {
  test('10-AC-01 first example of 5.1 gives exactly the stated limits', () => {
    expect(deriveEntry(reportAggregate(EXAMPLE_1), 'api', cfg())).toEqual({
      t: 500,
      median: 220,
      percentile: 364,
      p99: 492,
      minApdex: 0.947,
      maxWilson: 0.03,
      maxErrorRate: 0.05,
    });
  });

  test('10-AC-01 second example of 5.1 (slow key, small sample) gives exactly the stated limits', () => {
    const stats = reportAggregate(EXAMPLE_2);
    expect(wilsonBounds(1, 12)?.lower).toBeCloseTo(0.0149, 4);
    expect(deriveEntry(stats, 'api', cfg())).toEqual({
      t: null,
      median: 4680,
      percentile: 7380,
      p99: 8118,
      minApdex: null,
      maxWilson: null,
      maxErrorRate: 0.145,
    });
  });

  test('t is clamped to T.min and T.max and limited by medianFactor × p50', () => {
    const t = (percentiles: Record<string, number>): number | null =>
      deriveEntry(
        reportAggregate({ durations: [[30, percentiles['p50'] ?? 0]], percentiles }),
        'api',
        cfg(),
      ).t;
    expect(t({ p50: 100, p90: 300, p95: 300, p99: 300 })).toBe(500);
    expect(t({ p50: 400, p90: 700, p95: 800, p99: 900 })).toBe(700);
    expect(t({ p50: 400, p90: 1000, p95: 1100, p99: 1200 })).toBe(800);
    expect(t({ p50: 1900, p90: 2500, p95: 2600, p99: 2700 })).toBe(2000);
    expect(t({ p50: 2000, p90: 2500, p95: 2600, p99: 2700 })).toBe(2000);
    expect(t({ p50: 2000.1, p90: 2500, p95: 2600, p99: 2700 })).toBeNull();
  });

  test('small sample margins apply below thresholds.smallSampleN only', () => {
    const at = (n: number) =>
      deriveEntry(
        reportAggregate({
          durations: [[n, 1000]],
          percentiles: { p50: 1000, p90: 1000, p95: 1000, p99: 1000 },
        }),
        'api',
        cfg(),
      );
    expect(at(19)).toMatchObject({ median: 1800, percentile: 1800, maxWilson: 0.1 });
    expect(at(20)).toMatchObject({ median: 1400, percentile: 1400, maxWilson: 0.03 });
    expect(at(19).minApdex).toBe(0.9);
    expect(at(20).minApdex).toBe(0.95);
  });

  test('rounding: ms up to integers, minApdex down, ratios up to 3 places, in the order of 10-REQ-03', () => {
    // median = ceil(100.1 × 1.4 = 140.14 vs 200.1) = 201; percentile uses the rounded median.
    const e = deriveEntry(
      reportAggregate({
        durations: [[30, 100.1]],
        percentiles: { p50: 100.1, p90: 100.1, p95: 100.1, p99: 100.1 },
      }),
      'api',
      cfg(),
    );
    expect(e).toEqual({
      t: 500,
      median: 201,
      percentile: 201,
      p99: 251,
      minApdex: 0.95,
      maxWilson: 0.03,
      maxErrorRate: 0.05,
    });
  });

  test('p50 = 0 gives t = T.min and median = minMs', () => {
    const e = deriveEntry(
      reportAggregate({ durations: [[30, 0]], percentiles: { p50: 0, p90: 0, p95: 0, p99: 0 } }),
      'api',
      cfg(),
    );
    expect(e).toMatchObject({ t: 500, median: 100, percentile: 100, p99: 150 });
  });

  test('a very fast endpoint gets percentile = pE + minMs', () => {
    const e = deriveEntry(
      reportAggregate({ durations: [[30, 5]], percentiles: { p50: 5, p90: 5, p95: 5, p99: 5 } }),
      'api',
      cfg(),
    );
    expect(e.percentile).toBe(105);
  });

  test('all samples above t: maxWilson keeps the self gap above wLow and stays at most 1', () => {
    // Percentiles of the report below the retained samples (e.g. after sampling): every sample is
    // slower than the derived t.
    const stats = reportAggregate({
      durations: [[5000, 1500]],
      percentiles: { p50: 600, p90: 700, p95: 800, p99: 900 },
    });
    const e = deriveEntry(stats, 'api', cfg());
    expect(e.t).toBe(700);
    const wLow = wilsonBounds(5000, 5000)?.lower ?? 0;
    expect(e.maxWilson).toBeGreaterThanOrEqual(Math.min(1, wLow + WILSON_SELF_GAP));
    expect(e.maxWilson).toBeLessThanOrEqual(1);
  });

  test('only errors: maxErrorRate is capped at 1 and stays above eLow', () => {
    const stats = reportAggregate({ durations: [[5, 100]], errors: 5000 });
    const e = deriveEntry(stats, 'api', cfg());
    expect(e.maxErrorRate).toBe(1);
    expect(wilsonBounds(5000, 5005)?.lower ?? 1).toBeLessThan(1);
    expect(ERR_SELF_GAP).toBe(0.01);
  });

  test('the evaluated percentile missing from the report is computed from the durations', () => {
    const stats = reportAggregate({
      durations: [
        [10, 100],
        [10, 200],
      ],
      percentiles: { p50: 150, p90: 200, p95: 200, p99: 200 },
    });
    const config = cfg({ checks: { time: { percentile: { level: 'p75' } } } });
    // p75 of 10 × 100 and 10 × 200 = 200 (linear interpolation): 200 × 1.4 = 280.
    expect(deriveEntry(stats, 'api', config).percentile).toBe(300);
  });

  test('10-AC-14 percentile equals median with median margin 1.0 and percentile margin 0.1', () => {
    const config = cfg({
      checks: {
        time: {
          median: { margin: { relative: 1, minMs: 0 } },
          percentile: { margin: { relative: 0.1, minMs: 0 } },
        },
      },
    });
    const e = deriveEntry(
      reportAggregate({
        durations: [[30, 400]],
        percentiles: { p50: 400, p90: 450, p95: 500, p99: 600 },
      }),
      'api',
      config,
    );
    expect(e.median).toBe(800);
    expect(e.percentile).toBe(800);
  });

  test('10-AC-14 p99 is 1 ms above percentile with p99 margin { relative 0, minGapMs 1, minGapRelative 0 } and p99 = pE', () => {
    const config = cfg({
      checks: { time: { p99: { margin: { relative: 0, minGapMs: 1, minGapRelative: 0 } } } },
    });
    const e = deriveEntry(
      reportAggregate({
        durations: [[30, 400]],
        percentiles: { p50: 400, p90: 500, p95: 500, p99: 500 },
      }),
      'api',
      config,
    );
    expect(e.p99).toBe(e.percentile + 1);
  });

  test('10-AC-04 every derived entry has median ≤ percentile < p99 and ratios at most 1', () => {
    const configs = [
      cfg(),
      cfg({ checks: { time: { percentile: { level: 'p50' } } } }),
      cfg({
        checks: {
          time: {
            median: { margin: { relative: 2, minMs: 500, smallSampleRelative: 3 } },
            percentile: { margin: { relative: 0, minMs: 0, smallSampleRelative: 0 } },
            p99: { margin: { relative: 0, minGapMs: 1, minGapRelative: 0 } },
          },
        },
      }),
    ];
    for (let seed = 1; seed <= 200; seed += 1) {
      for (const config of configs) {
        const level = config.checks.time.percentile.level;
        const stats = reportAggregate(randomSpec(seed), level);
        for (const kind of ['api'] as const) {
          const e = deriveEntry(stats, kind, config);
          expect(e.median).toBeLessThanOrEqual(e.percentile);
          expect(e.percentile).toBeLessThan(e.p99);
          expect(e.maxErrorRate).toBeLessThanOrEqual(1);
          if (e.maxWilson !== null) expect(e.maxWilson).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  test('10-AC-12 a key with p50 above T.max gets null t, minApdex and maxWilson and no apdex or wilson checks', () => {
    const report = runReport({ endpoints: { [KEY]: { durations: [[200, 2600]] } } });
    const d = derive({ endpoints: { [KEY]: { durations: [[200, 2600]] } } });
    expect(entryOf(d)).toMatchObject({ t: null, minApdex: null, maxWilson: null });
    const evaluation = evaluate(
      { endpoints: report.endpoints },
      existing(file('api', content(d).entries)),
      cfg(),
      options(),
    );
    const rules = evaluation.perKey.api[KEY]?.checks.map((c) => c.rule);
    expect(rules).toEqual(['median', 'percentile', 'p99', 'errors']);
  });
});

/** Run reports of test/golden/run-report/valid/ and the derive golden cases. */
function goldenReports(): { name: string; report: RunReport }[] {
  const dir = join(GOLDEN_DIR, 'run-report', 'valid');
  const reports = readdirSync(dir)
    .sort()
    .map((f) => ({
      name: f,
      report: (JSON.parse(readFileSync(join(dir, f), 'utf8')) as { input: RunReport }).input,
    }));
  const deriveDir = join(GOLDEN_DIR, 'derive');
  const derived = readdirSync(deriveDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      name: f,
      report: runReport(
        (JSON.parse(readFileSync(join(deriveDir, f), 'utf8')) as { input: { report: ReportSpec } })
          .input.report,
      ),
    }));
  const random = Array.from({ length: 50 }, (_, i) => ({
    name: `random-${i + 1}`,
    report: runReport({
      endpoints: { a: randomSpec(i + 1), b: randomSpec(i + 101), c: randomSpec(i + 201) },
    }),
  }));
  return [...reports, ...derived, ...random];
}

describe('self-consistency (10-REQ-05)', () => {
  test('10-AC-03 evaluating every golden report with its derived thresholds gives no violation', () => {
    const allOn = cfg({
      checks: {
        time: {
          median: { minSamples: 1 },
          percentile: { minSamples: 1 },
          p99: { minSamples: 1 },
        },
        slowShare: { apdex: { minSamples: 1 }, wilson: { minSamples: 1 } },
        errors: { minSamples: 1 },
      },
    });
    let evaluated = 0;
    for (const { name, report } of goldenReports()) {
      for (const config of [cfg(), allOn]) {
        const entries: Record<Kind, Record<string, ThresholdsEntry>> = { api: {} };
        for (const kind of ['api'] as const) {
          const aggregates = report.endpoints;
          for (const [key, stats] of Object.entries(aggregates)) {
            if (stats.stats === null) continue;
            const entry = deriveEntry(stats, kind, config);
            entries[kind][key] = entry;
            expect(entrySelfConsistent(entry, stats, kind, config), `${name} ${key}`).toBe(true);
          }
        }
        const evaluation = evaluate(
          { endpoints: report.endpoints },
          existing(file('api', entries.api)),
          config,
          options(),
        );
        for (const kind of ['api'] as const) {
          for (const [key, e] of Object.entries(evaluation.perKey[kind])) {
            // Keys without a derived entry (no successful samples) use default thresholds.
            if (entries[kind][key] === undefined) continue;
            const failedChecks = e.checks.filter((c) => !c.passed);
            expect(failedChecks, `${name} ${kind} ${key}`).toEqual([]);
            evaluated += e.checks.length;
          }
        }
      }
    }
    expect(evaluated).toBeGreaterThan(0);
  });

  test('entrySelfConsistent checks a limit of a rule that is disabled or below minSamples', () => {
    const stats = reportAggregate({
      durations: [[40, 300]],
      percentiles: { p50: 300, p90: 300, p95: 300, p99: 900 },
    });
    const entry: ThresholdsEntry = {
      t: 500,
      median: 500,
      percentile: 500,
      p99: 800,
      minApdex: 0.9,
      maxWilson: 0.1,
      maxErrorRate: 0.05,
    };
    expect(entrySelfConsistent(entry, stats, 'api', cfg())).toBe(false);
    expect(entrySelfConsistent({ ...entry, p99: 900 }, stats, 'api', cfg())).toBe(true);
    const disabled = cfg({ checks: { time: { p99: { enabled: false } } } });
    expect(entrySelfConsistent(entry, stats, 'api', disabled)).toBe(false);
  });
});

describe('deriveThresholds (10, chapters 6–8)', () => {
  const SPEC: ReportSpec = { endpoints: { [KEY]: EXAMPLE_1 } };

  test('first derivation adds every key with enough samples and writes the generated block', () => {
    const d = derive({
      endpoints: { [KEY]: EXAMPLE_1, 'GET /api/rare': { durations: [[4, 100]] } },
      projects: [
        { name: 'webkit', role: 'measured', browserName: 'webkit', repeatEach: 10, retries: 0 },
        { name: 'chromium', role: 'measured', browserName: 'chromium', repeatEach: 10, retries: 0 },
        {
          name: 'chromium-2',
          role: 'measured',
          browserName: 'chromium',
          repeatEach: 10,
          retries: 0,
        },
        { name: 'setup', role: 'dependency', browserName: 'firefox', repeatEach: 1, retries: 0 },
      ],
    });
    expect(d.files.map((f) => [f.kind, f.changed])).toEqual([['api', true]]);
    const api = content(d);
    expect(Object.keys(api.entries)).toEqual([KEY]);
    expect(api.generated).toEqual(
      generated({
        sourceRunId: 'run-1',
        sourceRunStartedAt: '2026-11-18T10:00:00.000Z',
        sourceSampleCount: 204,
        browsers: ['chromium', 'webkit'],
      }),
    );
    expect(api.generated?.derivation.t).toEqual({ min: 500, max: 2000, medianFactor: 2 });
    for (const f of d.files) {
      const parsed = parseThresholdsFile(stringifyStable(f.content), 'x', f.kind);
      expect(parsed.ok).toBe(true);
    }
    expect(d.warnings).toEqual([]);
  });

  test('10-AC-02 deriving twice from the same report gives identical bytes and changes no file', () => {
    const first = derive(SPEC);
    const files = existing(loadedFile(content(first)));
    const second = derive(SPEC, files);
    const again = derive(SPEC, files);
    expect(stringifyStable(second)).toBe(stringifyStable(again));
    expect(second.files.find((f) => f.kind === 'api')?.changed).toBe(false);
    expect(stringifyStable(content(second))).toBe(stringifyStable(content(first)));
  });

  test('10-AC-05 locked and incomplete entries are byte-identical before and after, also with --prune', () => {
    const entries: Record<string, ThresholdsEntry> = {
      [KEY]: {
        locked: true,
        note: 'hand-tuned',
        t: null,
        median: 50,
        percentile: 60,
        p99: 70,
        minApdex: null,
        maxWilson: null,
        maxErrorRate: 0.5,
      },
      'GET /api/partial': { percentile: 3000 },
      'GET /api/muted-only': { gate: 'warn', note: 'flaky backend', until: '2026-12-31' },
      'GET /api/locked-unseen': { locked: true, percentile: 100 },
    };
    for (const prune of [false, true]) {
      const d = derive(
        {
          endpoints: {
            [KEY]: EXAMPLE_1,
            'GET /api/partial': EXAMPLE_1,
            'GET /api/muted-only': EXAMPLE_1,
          },
        },
        existing(file('api', structuredClone(entries))),
        cfg(),
        prune,
      );
      for (const [key, entry] of Object.entries(entries)) {
        expect(stringifyStable(entryOf(d, key))).toBe(stringifyStable(entry));
      }
    }
  });

  test('10-AC-06 without --prune no entry disappears; with --prune only unlocked unseen entries do', () => {
    const entries: Record<string, ThresholdsEntry> = {
      [KEY]: deriveEntry(reportAggregate(EXAMPLE_1), 'api', cfg()),
      'GET /api/unseen': { ...deriveEntry(reportAggregate(EXAMPLE_1), 'api', cfg()) },
      'GET /api/unseen-locked': { locked: true, median: 100 },
      'GET /api/unseen-incomplete': { median: 100 },
      'GET /api/rare': { ...deriveEntry(reportAggregate(EXAMPLE_1), 'api', cfg()) },
    };
    const spec: ReportSpec = {
      endpoints: { [KEY]: EXAMPLE_1, 'GET /api/rare': { durations: [[2, 100]] } },
    };
    const kept = derive(spec, existing(file('api', entries)));
    expect(Object.keys(content(kept).entries).sort()).toEqual(Object.keys(entries).sort());
    const pruned = derive(spec, existing(file('api', entries)), cfg(), true);
    expect(Object.keys(content(pruned).entries).sort()).toEqual(
      Object.keys(entries)
        .filter((k) => k !== 'GET /api/unseen')
        .sort(),
    );
  });

  test('10-AC-07 a report without aggregates gives THRESHOLDS_EMPTY_REPORT and nothing to write', () => {
    expect(refused(runReport()).map((i) => i.code)).toEqual(['THRESHOLDS_EMPTY_REPORT']);
  });

  test('a report without any key with enough samples gives THRESHOLDS_NOTHING_TO_DERIVE', () => {
    const report = runReport({
      endpoints: { a: { durations: [[4, 100]] }, b: { errors: 20 }, c: { durations: [[1, 100]] } },
    });
    expect(refused(report).map((i) => i.code)).toEqual(['THRESHOLDS_NOTHING_TO_DERIVE']);
  });

  test('10-AC-11 an interrupted, timed out or tool-error source gives THRESHOLDS_SOURCE_INCOMPLETE, also with --prune', () => {
    const cases: ReportSpec[] = [
      { ...SPEC, tests: { status: 'interrupted' } },
      { ...SPEC, tests: { status: 'timedout' } },
      {
        ...SPEC,
        toolErrors: [
          { code: 'RUN_INCOMPLETE', message: 'x' },
          { code: 'RUN_INCOMPLETE', message: 'y' },
        ],
      },
    ];
    for (const spec of cases) {
      for (const prune of [false, true]) {
        const issues = refused(
          runReport(spec),
          existing(file('api', { old: { median: 1 } })),
          prune,
        );
        expect(issues.map((i) => i.code)).toEqual(['THRESHOLDS_SOURCE_INCOMPLETE']);
      }
    }
    const issue = refused(runReport(cases[2]))[0];
    expect(issue?.message).toContain('tool errors: RUN_INCOMPLETE)');
    expect(refused(runReport(cases[0]))[0]?.message).toContain('tests interrupted');
  });

  test('an invalid existing thresholds file stops the derivation of every kind with its schema code', () => {
    const files = existing({
      status: 'invalid',
      kind: 'api',
      path: 'pw-perf-thresholds.api.json',
      issues: [
        {
          code: 'SCHEMA_INVALID_JSON',
          source: 'pw-perf-thresholds.api.json',
          message: 'bad',
          problems: [],
        },
      ],
    });
    expect(refused(runReport(SPEC), files).map((i) => i.code)).toEqual(['SCHEMA_INVALID_JSON']);
  });

  describe('10-AC-08 rules of 10-REQ-07 for both update modes', () => {
    const fresh = deriveEntry(reportAggregate(EXAMPLE_1), 'api', cfg());
    const far = { ...fresh, median: 1000, percentile: 2000, p99: 3000 };
    const entries: Record<string, ThresholdsEntry> = {
      locked: { ...far, locked: true, note: 'n' },
      incomplete: { median: 1000 },
      complete: far,
      'small-n': far,
      unseen: far,
      'unseen-locked': { ...far, locked: true },
    };
    const spec: ReportSpec = {
      endpoints: {
        locked: EXAMPLE_1,
        incomplete: EXAMPLE_1,
        complete: EXAMPLE_1,
        new: EXAMPLE_1,
        'small-n': { durations: [[4, 100]] },
        'new-small-n': { durations: [[4, 100]] },
      },
    };
    const expected: Record<'all' | 'new-only', Record<string, ThresholdsEntry | undefined>> = {
      all: { ...entries, complete: fresh, new: fresh, 'new-small-n': undefined },
      'new-only': { ...entries, new: fresh, 'new-small-n': undefined },
    };
    for (const update of ['all', 'new-only'] as const) {
      test(`update: ${update}`, () => {
        const d = derive(
          spec,
          existing(file('api', structuredClone(entries))),
          cfg({ thresholds: { update } }),
        );
        const result = content(d).entries;
        for (const [key, entry] of Object.entries(expected[update])) {
          expect(result[key], key).toEqual(entry);
        }
        const pruned = derive(
          spec,
          existing(file('api', structuredClone(entries))),
          cfg({ thresholds: { update } }),
          true,
        );
        expect(content(pruned).entries['unseen']).toBeUndefined();
        expect(content(pruned).entries['unseen-locked']).toEqual(entries['unseen-locked']);
      });
    }
  });

  test('10-AC-10 percentiles 5% off the previous source keep the entries and the file; 15% in one limit replaces the whole entry', () => {
    const scale = (f: number): ReportAggregateSpec => ({
      durations: [[200, 1000 * f]],
      percentiles: { p50: 1000 * f, p90: 1100 * f, p95: 1200 * f, p99: 1300 * f },
    });
    const previous = derive({ endpoints: { [KEY]: scale(1) } });
    const files = existing(loadedFile(content(previous)));
    const close = derive({ endpoints: { [KEY]: scale(1.05) }, runId: 'run-2' }, files);
    expect(close.files[0]?.changed).toBe(false);
    expect(content(close)).toEqual(content(previous));

    const far: ReportAggregateSpec = {
      durations: [[200, 1000]],
      percentiles: { p50: 1000, p90: 1100, p95: 1200 * 1.15, p99: 1300 * 1.15 },
    };
    const replaced = derive({ endpoints: { [KEY]: far }, runId: 'run-2' }, files);
    expect(replaced.files[0]?.changed).toBe(true);
    expect(entryOf(replaced)).toEqual(deriveEntry(reportAggregate(far), 'api', cfg()));
  });

  test('10-AC-13 a report of another run with all entries within hysteresis does not write the file', () => {
    const previous = derive(SPEC);
    const files = existing(loadedFile(content(previous)));
    const next = derive({ ...SPEC, runId: 'run-9', startedAt: '2026-11-19T10:00:00.000Z' }, files);
    expect(next.files[0]?.changed).toBe(false);
    expect(content(next).generated?.sourceRunId).toBe('run-1');
  });

  test('10-AC-15 hysteresis does not keep an entry whose p99 (rule not run at 40 samples) is below the source p99', () => {
    const config = cfg({
      checks: { time: { p99: { margin: { relative: 0, minGapMs: 1, minGapRelative: 0 } } } },
    });
    const spec: ReportSpec = {
      endpoints: {
        [KEY]: { durations: [[40, 300]], percentiles: { p50: 300, p90: 300, p95: 300, p99: 1000 } },
      },
    };
    const fresh = deriveEntry(reportAggregate(spec.endpoints?.[KEY] ?? {}), 'api', config);
    expect(fresh.p99).toBe(1000);
    const old = { ...fresh, p99: 950 };
    const d = derive(spec, existing(file('api', { [KEY]: old })), config);
    expect(entryOf(d)).toEqual(fresh);
    // The same entry with p99 above the source p99 is kept.
    const ok = { ...fresh, p99: 1050 };
    expect(entryOf(derive(spec, existing(file('api', { [KEY]: ok })), config))).toEqual(ok);
  });

  test('10-AC-16 another host or Playwright minor writes the file with a new generated block; another patch does not', () => {
    const previous = derive(SPEC);
    const files = existing(loadedFile(content(previous)));
    const host = derive({ ...SPEC, runId: 'run-2', host: { cpuModel: 'Other CPU' } }, files);
    expect(host.files[0]?.changed).toBe(true);
    expect(content(host).generated?.host.cpuModel).toBe('Other CPU');
    expect(content(host).generated?.sourceRunId).toBe('run-2');
    expect(content(host).entries).toEqual(content(previous).entries);
    expect(codes(host)).toContain('THRESHOLDS_SOURCE_MISMATCH');

    const minor = derive({ ...SPEC, playwrightVersion: '1.58.0' }, files);
    expect(minor.files[0]?.changed).toBe(true);
    expect(content(minor).generated?.playwrightVersion).toBe('1.58.0');

    const patch = derive({ ...SPEC, runId: 'run-3', playwrightVersion: '1.57.3' }, files);
    expect(patch.files[0]?.changed).toBe(false);
    expect(content(patch).generated?.playwrightVersion).toBe('1.57.0');
    expect(codes(patch)).not.toContain('THRESHOLDS_SOURCE_MISMATCH');
  });

  test('the file is written when env, evaluated percentile, derivation, browsers, normalization or format version changed', () => {
    const previous = content(derive(SPEC));
    const variants: [string, () => DerivedThresholds][] = [
      [
        'env',
        () => {
          const r = deriveThresholds(
            runReport({ ...SPEC, env: 'qa' }),
            cfg(),
            existing(loadedFile(previous)),
            deriveOptions({ env: 'qa' }),
          );
          if (!r.ok) throw new Error('refused');
          return r.value;
        },
      ],
      [
        'level',
        () =>
          derive(
            SPEC,
            existing(loadedFile(previous)),
            cfg({ checks: { time: { percentile: { level: 'p90' } } } }),
          ),
      ],
      [
        'derivation',
        () =>
          derive(SPEC, existing(loadedFile(previous)), cfg({ thresholds: { smallSampleN: 10 } })),
      ],
      [
        'browsers',
        () =>
          derive(
            {
              ...SPEC,
              projects: [
                { name: 'f', role: 'measured', browserName: 'firefox', repeatEach: 10, retries: 0 },
              ],
            },
            existing(loadedFile(previous)),
          ),
      ],
      [
        'normalization',
        () => derive({ ...SPEC, normalization: 'ffffffffffffff' }, existing(loadedFile(previous))),
      ],
      ['migrated', () => derive(SPEC, existing(loadedFile(previous, 0)))],
    ];
    for (const [name, run] of variants) {
      expect(run().files[0]?.changed, name).toBe(true);
    }
  });

  test('10-AC-18 a recomputed entry keeps gate, note and until byte for byte', () => {
    const old: ThresholdsEntry = {
      t: 500,
      median: 1000,
      percentile: 2000,
      p99: 3000,
      minApdex: 0.5,
      maxWilson: 0.5,
      maxErrorRate: 0.5,
      gate: 'warn',
      note: 'Backend team is on it — ticket #12',
      until: '2026-11-01',
    };
    const d = derive(SPEC, existing(file('api', { [KEY]: old })));
    const entry = entryOf(d);
    expect(entry).toEqual({
      ...deriveEntry(reportAggregate(EXAMPLE_1), 'api', cfg()),
      gate: 'warn',
      note: old.note,
      until: '2026-11-01',
    });
  });

  test('warnings of the source: env mismatch, failed tests, test mode, manual file', () => {
    const report = runReport({ ...SPEC, env: 'staging', mode: 'test', tests: { unexpected: 2 } });
    const r = deriveThresholds(
      report,
      cfg(),
      existing(file('api', {}, null)),
      deriveOptions({ env: 'qa' }),
    );
    if (!r.ok) throw new Error('refused');
    expect(r.value.warnings.map((w) => w.code)).toEqual([
      'THRESHOLDS_ENV_MISMATCH',
      'THRESHOLDS_SOURCE_TESTS_FAILED',
      'THRESHOLDS_SOURCE_TEST_MODE',
      'THRESHOLDS_MANUAL_FILE',
    ]);
    expect(r.value.files[0]?.content?.generated?.env).toBe('qa');
    expect(r.value.files[0]?.changed).toBe(true);
  });

  test('10-AC-17 a percentile limit 60% higher gives one THRESHOLDS_LOOSENED_MUCH with the entry count; 40% does not', () => {
    const fresh = deriveEntry(reportAggregate(EXAMPLE_1), 'api', cfg());
    const at = (factor: number): DerivedThresholds =>
      derive(
        { endpoints: { a: EXAMPLE_1, b: EXAMPLE_1 } },
        existing(
          file('api', {
            a: { ...fresh, percentile: Math.round(fresh.percentile / factor) },
            b: { ...fresh, percentile: Math.round(fresh.percentile / factor) },
          }),
        ),
      );
    const much = at(1.6);
    expect(codes(much)).toEqual(['THRESHOLDS_LOOSENED_MUCH']);
    expect(much.warnings[0]?.message).toMatch(
      /^2 entries have a time limit that grew by more than 50%/u,
    );
    expect(codes(at(1.4))).toEqual([]);
  });
});
