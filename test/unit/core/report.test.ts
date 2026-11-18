import { describe, expect, test } from 'vitest';
import { stringifyStable } from '../../../src/core/format/index.ts';
import { buildRunReport, collapseIssues } from '../../../src/core/report/index.ts';
import type { RunReportInput } from '../../../src/core/report/index.ts';
import { parseRunReport } from '../../../src/core/schema/index.ts';
import type { AggregateStats, KeyEvaluation, RunReport } from '../../../src/core/types/index.ts';
import { loadCases } from '../../contract/golden.ts';

function goldenReport(file: string): RunReport {
  const found = loadCases('run-report').find((c) => c.dir === 'valid' && c.file === file);
  if (found === undefined) throw new Error(file);
  return structuredClone(found.input) as RunReport;
}

/** Splits a report into the input buildRunReport gets from the reporter. */
function inputOf(report: RunReport): RunReportInput {
  const split = (aggregates: RunReport['endpoints']) => {
    const stats: Record<string, AggregateStats> = {};
    const perKey: Record<string, KeyEvaluation> = {};
    for (const [key, { evaluation, ...rest }] of Object.entries(aggregates)) {
      stats[key] = rest;
      perKey[key] = evaluation;
    }
    return { stats, perKey };
  };
  const endpoints = split(report.endpoints);
  const custom = split(report.custom);
  return {
    meta: {
      tool: report.tool,
      runId: report.runId,
      mode: report.mode,
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      env: report.env,
      configDir: report.configDir,
      ci: report.ci,
      host: report.host,
      playwright: report.playwright,
    },
    config: report.config,
    normalization: report.normalization,
    runConditions: report.runConditions,
    tests: report.tests,
    aggregates: { endpoints: endpoints.stats, custom: custom.stats, origins: report.origins },
    evaluation: {
      ...report.evaluation,
      perKey: { api: endpoints.perKey, custom: custom.perKey },
      thresholdFiles: report.thresholdFiles,
    },
    warnings: report.warnings,
    toolErrors: report.toolErrors,
  };
}

const KEY = 'GET /api/tickets/:id';
const RAW_URL = 'https://app.example/api/tickets/42?search=secret';

function withRawUrl(rawUrls: boolean | undefined): RunReportInput {
  const report = goldenReport('full-run.json');
  if (rawUrls !== undefined) report.config = { ...report.config, report: { rawUrls } };
  const input = inputOf(report);
  const aggregate = input.aggregates.endpoints[KEY];
  if (aggregate === undefined) throw new Error(KEY);
  aggregate.slowest = aggregate.slowest.map((s) => ({
    ...s,
    url: RAW_URL,
  })) as typeof aggregate.slowest;
  return input;
}

describe('buildRunReport (02, chapter 9.1)', () => {
  test('rebuilds a report from its parts and the result is a valid run report', () => {
    for (const file of ['full-run.json', 'empty-run.json', 'thresholds-mode-sparse-config.json']) {
      const report = goldenReport(file);
      const built = buildRunReport(inputOf(report));
      expect(built, file).toEqual(report);
      expect(parseRunReport(stringifyStable(built), file).ok).toBe(true);
    }
  });

  test('02-AC-06 with the default config the report contains no raw URL in any field', () => {
    for (const rawUrls of [undefined, false]) {
      const text = stringifyStable(buildRunReport(withRawUrl(rawUrls)));
      expect(text).not.toContain(RAW_URL);
      expect(text).not.toContain('api/tickets/42');
      expect(text).not.toContain('"url"');
    }
  });

  test('02-AC-06 slowest[].url is kept only with report.rawUrls', () => {
    const built = buildRunReport(withRawUrl(true));
    expect(built.endpoints[KEY]?.slowest.map((s) => s.url)).toEqual([RAW_URL, RAW_URL]);
    expect(parseRunReport(stringifyStable(built), 'r').ok).toBe(true);
  });

  test('rounds durations and statistics to 0.1 ms (02-REQ-07)', () => {
    const input = inputOf(goldenReport('full-run.json'));
    const aggregate = input.aggregates.endpoints[KEY];
    if (aggregate?.stats == null || aggregate.ttfb == null) throw new Error('fixture');
    aggregate.stats = {
      min: 150.123,
      avg: 186.94999,
      max: 250.04,
      percentiles: { ...aggregate.stats.percentiles, p50: 180.25 },
    };
    aggregate.ttfb = { p50: 120.55, p95: 199.96 };
    aggregate.slowest = aggregate.slowest.map((s) => ({
      ...s,
      duration: s.duration + 0.04,
    })) as typeof aggregate.slowest;
    aggregate.samples = { durations: [100.04, 99.96], sampled: false };
    const built = buildRunReport(input).endpoints[KEY];
    expect(built?.stats).toMatchObject({
      min: 150.1,
      avg: 186.9,
      max: 250,
      percentiles: { p50: 180.3 },
    });
    expect(built?.ttfb).toEqual({ p50: 120.6, p95: 200 });
    expect(built?.slowest.map((s) => s.duration)).toEqual([250, 210.3]);
    expect(built?.samples.durations).toEqual([100, 100]);
  });

  test('orders arrays as 02-REQ-20 and 08-REQ-33 say', () => {
    const input = inputOf(goldenReport('full-run.json'));
    const aggregate = input.aggregates.endpoints[KEY];
    if (aggregate === undefined) throw new Error('fixture');
    const test = { title: 't', project: 'p', file: 'b.spec.ts', line: 5, repeatEachIndex: 1 };
    const startedAt = '2026-11-18T10:00:00.000Z';
    aggregate.slowest = [
      { duration: 100, startedAt, test: { ...test, repeatEachIndex: 2 } },
      { duration: 100, startedAt, test },
      { duration: 300, startedAt, test },
    ];
    aggregate.topTests = [
      { title: 'b', project: 'p', file: 'a.spec.ts', line: 1, sampleCount: 2 },
      { title: 'a', project: 'p', file: 'a.spec.ts', line: 1, sampleCount: 2 },
      { title: 'z', project: 'p', file: 'z.spec.ts', line: 9, sampleCount: 7 },
    ];
    aggregate.samples = { durations: [3, 1, 2], sampled: true };
    input.aggregates.origins = [
      { origin: 'https://b.example', label: 'b.example', requestCount: 1 },
      { origin: 'https://a.example', label: '', requestCount: 2 },
    ];
    input.evaluation.thresholdFiles = [
      { kind: 'custom', path: 'c.json', status: 'missing', generated: null, unseenKeys: [] },
      {
        kind: 'api',
        path: 'a.json',
        status: 'loaded',
        generated: null,
        unseenKeys: ['b', 'B', 'a'],
      },
    ];

    const built = buildRunReport(input);
    const agg = built.endpoints[KEY];
    expect(agg?.slowest.map((s) => [s.duration, s.test.repeatEachIndex])).toEqual([
      [300, 1],
      [100, 1],
      [100, 2],
    ]);
    expect(agg?.topTests.map((t) => t.title)).toEqual(['z', 'a', 'b']);
    expect(agg?.samples.durations).toEqual([1, 2, 3]);
    expect(built.origins.map((o) => o.origin)).toEqual(['https://a.example', 'https://b.example']);
    expect(built.thresholdFiles.map((f) => f.kind)).toEqual(['api', 'custom']);
    expect(built.thresholdFiles[0]?.unseenKeys).toEqual(['B', 'a', 'b']);
  });

  test('does not change its input', () => {
    const input = withRawUrl(false);
    const before = structuredClone(input);
    buildRunReport(input);
    expect(input).toEqual(before);
  });

  test('same input in another order gives byte-identical JSON (P-06)', () => {
    const input = inputOf(goldenReport('full-run.json'));
    const reversed: RunReportInput = {
      ...input,
      aggregates: {
        ...input.aggregates,
        endpoints: Object.fromEntries(Object.entries(input.aggregates.endpoints).reverse()),
      },
      evaluation: {
        ...input.evaluation,
        thresholdFiles: [...input.evaluation.thresholdFiles].reverse(),
      },
    };
    expect(stringifyStable(buildRunReport(reversed))).toBe(stringifyStable(buildRunReport(input)));
  });

  test('a key without evaluation, or an evaluation without aggregate, is a programming error', () => {
    const input = inputOf(goldenReport('full-run.json'));
    const { [KEY]: _dropped, ...perKey } = input.evaluation.perKey.api;
    expect(() =>
      buildRunReport({
        ...input,
        evaluation: { ...input.evaluation, perKey: { ...input.evaluation.perKey, api: perKey } },
      }),
    ).toThrow(/no evaluation for api key "GET \/api\/tickets\/:id"/);
    const { [KEY]: _gone, ...endpoints } = input.aggregates.endpoints;
    expect(() =>
      buildRunReport({ ...input, aggregates: { ...input.aggregates, endpoints } }),
    ).toThrow(/evaluation for unknown api key/);
  });

  test('collapses repeated warnings and tool errors (02-REQ-20)', () => {
    const input = inputOf(goldenReport('empty-run.json'));
    input.warnings = [
      { code: 'A', message: 'one' },
      { code: 'B', message: 'two', hint: 'h' },
      { code: 'A', message: 'one', count: 2 },
      { code: 'A', message: 'other' },
    ];
    input.toolErrors = [
      { code: 'E', message: 'x' },
      { code: 'E', message: 'x' },
    ];
    const built = buildRunReport(input);
    expect(built.warnings).toEqual([
      { code: 'A', message: 'one', count: 3 },
      { code: 'B', message: 'two', hint: 'h' },
      { code: 'A', message: 'other' },
    ]);
    expect(built.toolErrors).toEqual([{ code: 'E', message: 'x', count: 2 }]);
  });
});

describe('collapseIssues', () => {
  test('keeps the first occurrence and its hint, sums counts', () => {
    expect(
      collapseIssues([
        { code: 'A', message: 'm', hint: 'first' },
        { code: 'A', message: 'm', hint: 'second', count: 4 },
      ]),
    ).toEqual([{ code: 'A', message: 'm', hint: 'first', count: 5 }]);
  });
});
