import { describe, expect, test } from 'vitest';
import { assessRun, buildOutcome, evaluate } from '../../../src/core/evaluate/index.ts';
import type { LoadedThresholds } from '../../../src/core/evaluate/index.ts';
import { stringifyStable } from '../../../src/core/format/index.ts';
import { buildRunReport } from '../../../src/core/report/index.ts';
import { parseOutcome } from '../../../src/core/schema/index.ts';
import type { Outcome, RunReport } from '../../../src/core/types/index.ts';
import { loadCases } from '../../contract/golden.ts';
import {
  NO_TEST_BREAKDOWN,
  aggregates,
  files,
  config,
  invalid,
  loaded,
  options,
} from './evaluate-helpers.ts';
import type { AggregateSpec } from './evaluate-helpers.ts';

const KEY = 'GET /api/tickets';
const PATHS: Outcome['paths'] = {
  reportJson: '/repo/pw-perf-results/report.json',
  reportHtml: '/repo/pw-perf-results/report.html',
  thresholds: [],
  thresholdsDiff: null,
};

type Tests = RunReport['tests'];
const tests = (unexpected: number, partial: Partial<Tests> = {}): Tests => ({
  status: unexpected > 0 ? 'failed' : 'passed',
  expected: 100 - unexpected,
  unexpected,
  flaky: 0,
  skipped: 0,
  ...partial,
});

interface Run {
  spec?: AggregateSpec;
  thresholds?: LoadedThresholds;
  tests?: Tests;
  mode?: 'test' | 'thresholds';
  maxFailures?: number;
  sharded?: boolean;
}

/** The reporter's onEnd in core terms: evaluate, assess, build report and outcome. */
function run(r: Run = {}): { report: RunReport; outcome: Outcome } {
  const base = structuredClone(
    loadCases('run-report').find((c) => c.dir === 'valid' && c.file === 'full-run.json')?.input,
  ) as RunReport;
  const cfg = config();
  const mode = r.mode ?? 'test';
  const aggs = aggregates({ [KEY]: r.spec ?? { durations: [[20, 100]] } });
  const evaluation = evaluate(
    aggs,
    r.thresholds ?? files(loaded('api', { [KEY]: { percentile: 1400 } })),
    cfg,
    options({ mode }),
  );
  const assessment = assessRun(
    { tests: r.tests ?? tests(0), maxFailures: r.maxFailures ?? 0, sharded: r.sharded ?? false },
    cfg.gate,
  );
  const report = buildRunReport({
    meta: { ...base, mode },
    config: base.config,
    normalization: base.normalization,
    stepNormalization: null,
    runConditions: base.runConditions,
    tests: r.tests ?? tests(0),
    aggregates: { steps: {}, ...aggs, origins: [], testBreakdown: NO_TEST_BREAKDOWN },
    evaluation,
    warnings: [...assessment.warnings, ...evaluation.warnings],
    toolErrors: [...assessment.toolErrors, ...evaluation.toolErrors],
  });
  const outcome = buildOutcome(report, PATHS);
  expect(parseOutcome(stringifyStable(outcome), 'outcome.json').ok).toBe(true);
  return { report, outcome };
}

const codes = (issues: { code: string }[]): string[] => issues.map((i) => i.code);
const BLOCKING: AggregateSpec = { durations: [[20, 1500]] };

describe('assessRun (09-REQ-24)', () => {
  test('09-AC-12 1 failed execution of 100 without violations: code 0 and TESTS_FAILED', () => {
    const { report, outcome } = run({ tests: tests(1) });
    expect(outcome.exitCode).toBe(0);
    expect(codes(report.warnings)).toContain('TESTS_FAILED');
    expect(report.warnings.find((w) => w.code === 'TESTS_FAILED')?.message).toBe(
      '1 of 100 test executions failed; the performance result still decides.',
    );
    expect(report.toolErrors).toEqual([]);
  });

  test('09-AC-12 11 failed executions of 100: code 3 and TESTS_FAILED_TOO_MANY', () => {
    const { report, outcome } = run({ tests: tests(11) });
    expect(outcome.exitCode).toBe(3);
    expect(codes(outcome.toolErrors)).toEqual(['TESTS_FAILED_TOO_MANY']);
    expect(codes(report.warnings)).not.toContain('TESTS_FAILED');
    expect(outcome.toolErrors[0]?.message).toContain('11 of 100 test executions failed (11%');
  });

  test('09-AC-12 a blocking violation gives 2, with a tool error 3', () => {
    expect(run({ spec: BLOCKING }).outcome.exitCode).toBe(2);
    expect(run({ spec: BLOCKING, tests: tests(11) }).outcome.exitCode).toBe(3);
  });

  test('09-AC-12 tests.status timedout gives 3 with RUN_INCOMPLETE', () => {
    const { outcome } = run({ tests: tests(0, { status: 'timedout' }) });
    expect(outcome.exitCode).toBe(3);
    expect(codes(outcome.toolErrors)).toEqual(['RUN_INCOMPLETE']);
  });

  test('exactly gate.maxFailedTestShare is still a warning', () => {
    const result = assessRun(
      { tests: tests(10), maxFailures: 0, sharded: false },
      { maxFailedTestShare: 0.1 },
    );
    expect(codes(result.warnings)).toEqual(['TESTS_FAILED']);
    expect(result.toolErrors).toEqual([]);
  });

  test('flaky executions count, skipped do not', () => {
    const result = assessRun(
      {
        tests: { status: 'failed', expected: 8, unexpected: 1, flaky: 1, skipped: 50 },
        maxFailures: 0,
        sharded: false,
      },
      { maxFailedTestShare: 0.1 },
    );
    expect(codes(result.warnings)).toEqual(['TESTS_FAILED']);
    expect(result.warnings[0]?.message).toContain('1 of 10 test executions');
  });

  test('no executions: share 0, no issues', () => {
    const result = assessRun(
      {
        tests: { status: 'passed', expected: 0, unexpected: 0, flaky: 0, skipped: 3 },
        maxFailures: 0,
        sharded: false,
      },
      { maxFailedTestShare: 0 },
    );
    expect(result).toEqual({ warnings: [], toolErrors: [] });
  });

  test('interrupted, maxFailures reached and sharded runs are tool errors', () => {
    const gate = { maxFailedTestShare: 1 };
    const one = (input: Parameters<typeof assessRun>[0]) =>
      codes(assessRun(input, gate).toolErrors);
    expect(
      one({ tests: tests(0, { status: 'interrupted' }), maxFailures: 0, sharded: false }),
    ).toEqual(['RUN_INCOMPLETE']);
    expect(one({ tests: tests(3), maxFailures: 3, sharded: false })).toEqual(['RUN_INCOMPLETE']);
    expect(one({ tests: tests(2), maxFailures: 3, sharded: false })).toEqual([]);
    expect(one({ tests: tests(0), maxFailures: 0, sharded: true })).toEqual(['RUN_SHARDED']);
  });
});

describe('buildOutcome (09-REQ-25, 02-REQ-26)', () => {
  test('09-AC-05 an invalid api thresholds file gives exit code 3', () => {
    const { report, outcome } = run({ thresholds: files(invalid('api')) });
    expect(report.evaluation.status).toBe('error');
    expect(outcome.exitCode).toBe(3);
    expect(codes(outcome.toolErrors)).toEqual(['SCHEMA_INVALID_JSON']);
  });

  test('09-AC-07 thresholds mode never gives exit code 2', () => {
    const { report, outcome } = run({ spec: BLOCKING, mode: 'thresholds' });
    expect(report.evaluation).toMatchObject({ status: 'failed', gateEnabled: false });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.mode).toBe('thresholds');
  });

  test('warned gives exit code 0', () => {
    const { report, outcome } = run({
      spec: BLOCKING,
      thresholds: files(
        loaded('api', {
          [KEY]: { percentile: 1400, gate: 'warn', note: 'n', until: '2026-12-31' },
        }),
      ),
    });
    expect(report.evaluation.status).toBe('warned');
    expect(outcome.exitCode).toBe(0);
  });

  test('the outcome copies run id, statuses, tool errors and paths', () => {
    const { report, outcome } = run({ spec: BLOCKING, tests: tests(1) });
    expect(outcome).toEqual({
      schemaVersion: 1,
      runId: report.runId,
      mode: 'test',
      exitCode: 2,
      tests: { status: 'failed' },
      evaluation: { status: 'failed', gateEnabled: true },
      toolErrors: [],
      paths: PATHS,
    });
  });
});
