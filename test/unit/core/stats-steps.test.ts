// Aggregation of step samples (08-REQ-40, 06-REQ-28, 06-REQ-32).
import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../../../src/core/config/index.ts';
import { Aggregator, resultId, testIdentity } from '../../../src/core/stats/index.ts';
import type { AggregatorOptions, TestMeta } from '../../../src/core/stats/index.ts';
import type { RawStepSample } from '../../../src/core/steps/index.ts';

const cfg = (() => {
  const result = resolveConfig({ measure: { steps: true } }, {});
  if (!result.ok) throw new Error('config');
  return result.value.config;
})();

const OPTIONS: AggregatorOptions = {
  advanced: cfg.advanced,
  successStatuses: cfg.measure.successStatuses,
  errors: { statuses: cfg.checks.errors.statuses },
  measuredProjects: new Set(['chromium']),
  evaluatedPercentile: cfg.checks.time.percentile.level,
  rawUrls: false,
};

function meta(repeat: number, failed = false, project = 'chromium', title = 'checkout'): TestMeta {
  const file = 'tests/checkout.spec.ts';
  return {
    identity: testIdentity(project, file, title),
    resultId: resultId(`${file}:${title}`, repeat, 0),
    title,
    project,
    file,
    line: 5,
    repeatEachIndex: repeat,
    retry: 0,
    failed,
    startTime: Date.UTC(2026, 10, 20, 10, 0, 0) + repeat * 60_000,
  };
}

function sample(
  key: string,
  outcome: RawStepSample['outcome'],
  duration = 300,
  line = 12,
): RawStepSample {
  return {
    key,
    duration: outcome === 'unfinished' ? null : duration,
    endTime: outcome === 'unfinished' ? null : Date.UTC(2026, 10, 20, 10, 0, 1) + duration,
    outcome,
    location: { file: 'pages/checkout.page.ts', line },
  };
}

describe('06-AC-12 step outcomes in the aggregate', () => {
  test('error and unfinished count in errorCount, not in stats; time source node', () => {
    const a = new Aggregator(OPTIONS);
    const m = meta(0);
    a.addStep({ ...sample('pay', 'ok', 200), test: m, ordinal: 0 });
    a.addStep({ ...sample('pay', 'error', 900), test: m, ordinal: 1 });
    a.addStep({ ...sample('pay', 'unfinished'), test: m, ordinal: 2 });
    const pay = a.finalize().steps.pay;
    expect(pay).toMatchObject({
      count: 3,
      successCount: 1,
      errorCount: 2,
      statuses: { error: 1, ok: 1, unfinished: 1 },
      timeSources: { browser: 0, node: 3 },
      ttfb: null,
      stepErrorsFromFailedTests: 0,
      location: { file: 'pages/checkout.page.ts', line: 12 },
    });
    expect(pay?.stats?.max).toBe(200);
  });

  test('the location is the smallest (file, line) of the samples', () => {
    const a = new Aggregator(OPTIONS);
    a.addStep({ ...sample('pay', 'ok', 200, 40), test: meta(0), ordinal: 0 });
    a.addStep({ ...sample('pay', 'ok', 200, 7), test: meta(1), ordinal: 0 });
    expect(a.finalize().steps.pay?.location).toEqual({ file: 'pages/checkout.page.ts', line: 7 });
  });
});

describe('06-AC-19 errors of failed tests', () => {
  test('a failed step in 1 of 5 repetitions counts only in stepErrorsFromFailedTests', () => {
    const a = new Aggregator(OPTIONS);
    for (let r = 0; r < 4; r++) a.addStep({ ...sample('Pay', 'ok'), test: meta(r), ordinal: 0 });
    a.addStep({ ...sample('Pay', 'error'), test: meta(4, true), ordinal: 0 });
    const pay = a.finalize().steps.Pay;
    expect(pay).toMatchObject({
      successCount: 4,
      errorCount: 0,
      stepErrorsFromFailedTests: 1,
      fromFailedTests: 1,
    });
  });

  test('the same step error in a passed test counts as an error', () => {
    const a = new Aggregator(OPTIONS);
    a.addStep({ ...sample('Pay', 'error'), test: meta(0, false), ordinal: 0 });
    expect(a.finalize().steps.Pay).toMatchObject({ errorCount: 1, stepErrorsFromFailedTests: 0 });
  });
});

describe('06-AC-16 projects that are not measured', () => {
  test('a step of a setup project is not aggregated and counts as outside', () => {
    const a = new Aggregator(OPTIONS);
    a.addStep({ ...sample('login', 'ok'), test: meta(0, false, 'setup', 'login'), ordinal: 0 });
    const result = a.finalize();
    expect(result.steps).toEqual({});
    expect(result.issues.map((i) => i.code)).toContain('STATS_SAMPLES_OUTSIDE_MEASURED_PROJECTS');
    const quiet = new Aggregator({ ...OPTIONS, dependencyProjects: new Set(['setup']) });
    quiet.addStep({ ...sample('login', 'ok'), test: meta(0, false, 'setup', 'login'), ordinal: 0 });
    const without = quiet.finalize();
    expect(without.steps).toEqual({});
    expect(without.issues).toEqual([]);
  });

  test('steps stay out of the test breakdown (08-D-18)', () => {
    const a = new Aggregator(OPTIONS);
    const m = meta(0);
    a.addStep({ ...sample('pay', 'ok'), test: m, ordinal: 0 });
    a.endResult(m);
    const { testBreakdown } = a.finalize();
    expect(testBreakdown.tests.every((t) => t.keys.length === 0)).toBe(true);
  });
});
