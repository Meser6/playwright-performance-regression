// Assembly of the run report (02, chapters 7 and 9.1).
import { perfDefaults } from '../config/index.ts';
import { roundMs } from '../format/index.ts';
import { SCHEMA_VERSIONS } from '../schema/index.ts';
import type { TestBreakdownStats } from '../stats/index.ts';
import type {
  AggregateStats,
  EvaluatedKey,
  Issue,
  KeyEvaluation,
  Kind,
  RunReport,
  RunReportAggregate,
  SlowSample,
  TestCost,
  ThresholdFileInfo,
} from '../types/index.ts';
import { keyHints, withUsage } from './hints.ts';
import type { HintOptions } from './hints.ts';
import { collapseIssues } from './issues.ts';

/** The parts of the aggregation result (08) the report needs. */
export interface RunReportAggregates {
  endpoints: Record<string, AggregateStats>;
  origins: RunReport['origins'];
  /** 08-REQ-37, 08-REQ-38; null only when rebuilding a report migrated from version 1. */
  testBreakdown: TestBreakdownStats | null;
}

/** The parts of the evaluation result (09) the report needs; its warnings go to `warnings`. */
export interface RunReportEvaluation {
  status: RunReport['evaluation']['status'];
  gateEnabled: boolean;
  counts: RunReport['evaluation']['counts'];
  perKey: Record<Kind, Record<string, EvaluatedKey>>;
  thresholdFiles: ThresholdFileInfo[];
}

/** Violated keys listed per test (02-REQ-30). */
const MAX_VIOLATED_KEYS = 10;

export interface RunReportInput {
  meta: Pick<
    RunReport,
    | 'tool'
    | 'runId'
    | 'mode'
    | 'startedAt'
    | 'finishedAt'
    | 'env'
    | 'configDir'
    | 'ci'
    | 'host'
    | 'playwright'
  >;
  /** Effective config snapshot (02-REQ-17). */
  config: RunReport['config'];
  /** Normalization fingerprint (07-REQ-21). */
  normalization: string;
  runConditions: RunReport['runConditions'];
  tests: RunReport['tests'];
  aggregates: RunReportAggregates;
  evaluation: RunReportEvaluation;
  /** All warnings of the run in order of occurrence, including those of the evaluation. */
  warnings: Issue[];
  toolErrors: Issue[];
}

/** Code unit order, never localeCompare (02-REQ-04). */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareSlowest(a: SlowSample, b: SlowSample): number {
  return (
    b.duration - a.duration ||
    compareText(a.test.file, b.test.file) ||
    a.test.line - b.test.line ||
    a.test.repeatEachIndex - b.test.repeatEachIndex
  );
}

function buildAggregate(
  stats: AggregateStats,
  evaluated: EvaluatedKey,
  rawUrls: boolean,
  hintOptions: HintOptions,
): RunReportAggregate {
  const evaluation: KeyEvaluation = {
    ...structuredClone(evaluated),
    checks: withUsage(evaluated.checks),
  };
  return {
    ...stats,
    statuses: { ...stats.statuses },
    timeSources: { ...stats.timeSources },
    stats:
      stats.stats === null
        ? null
        : {
            min: roundMs(stats.stats.min),
            avg: roundMs(stats.stats.avg),
            max: roundMs(stats.stats.max),
            percentiles: Object.fromEntries(
              Object.entries(stats.stats.percentiles).map(([name, value]) => [
                name,
                roundMs(value),
              ]),
            ) as typeof stats.stats.percentiles,
          },
    ttfb:
      stats.ttfb === null
        ? null
        : {
            p50: roundMs(stats.ttfb.p50),
            p95: roundMs(stats.ttfb.p95),
            otherP50: stats.ttfb.otherP50 === null ? null : roundMs(stats.ttfb.otherP50),
          },
    // Raw URLs only with report.rawUrls (D-11, 02-REQ-16).
    slowest: stats.slowest
      .map(({ url, ...sample }) => ({
        ...sample,
        test: { ...sample.test },
        duration: roundMs(sample.duration),
        ...(rawUrls && url !== undefined ? { url } : {}),
      }))
      .sort(compareSlowest) as RunReportAggregate['slowest'],
    topTests: stats.topTests
      .map((t) => ({ ...t }))
      .sort(
        (a, b) =>
          b.sampleCount - a.sampleCount ||
          compareText(a.file, b.file) ||
          a.line - b.line ||
          compareText(a.title, b.title) ||
          compareText(a.project, b.project),
      ) as RunReportAggregate['topTests'],
    samples: {
      durations: stats.samples.durations.map(roundMs).sort((a, b) => a - b),
      sampled: stats.samples.sampled,
    },
    evaluation,
    // Edges are constants of the scale, not rounded (08-REQ-34).
    histogram:
      stats.histogram === null
        ? null
        : {
            edges: [...stats.histogram.edges] as typeof stats.histogram.edges,
            counts: [...stats.histogram.counts] as typeof stats.histogram.counts,
          },
    hints: keyHints({ ...stats, evaluation }, hintOptions) as RunReportAggregate['hints'],
  };
}

function buildAggregates(
  kind: Kind,
  aggregates: Record<string, AggregateStats>,
  perKey: Record<string, EvaluatedKey>,
  rawUrls: boolean,
  hintOptions: HintOptions,
): Record<string, RunReportAggregate> {
  for (const key of Object.keys(perKey)) {
    if (!Object.hasOwn(aggregates, key)) {
      throw new Error(`buildRunReport: evaluation for unknown ${kind} key "${key}"`);
    }
  }
  const result: Record<string, RunReportAggregate> = {};
  for (const key of Object.keys(aggregates).sort()) {
    const stats = aggregates[key];
    const evaluation = Object.hasOwn(perKey, key) ? perKey[key] : undefined;
    if (stats === undefined || evaluation === undefined) {
      throw new Error(`buildRunReport: no evaluation for ${kind} key "${key}"`);
    }
    result[key] = buildAggregate(stats, evaluation, rawUrls, hintOptions);
  }
  return result;
}

/** Adds violatedKeys from the evaluation of the endpoints and drops the key lists (08-REQ-37). */
function buildTestBreakdown(
  breakdown: TestBreakdownStats | null,
  endpoints: Record<string, RunReportAggregate>,
): RunReport['testBreakdown'] {
  if (breakdown === null) return null;
  const tests = breakdown.tests.map(({ keys, topKeys, ...test }): TestCost => {
    const violated = keys
      .filter((key) => endpoints[key]?.evaluation.result === 'fail')
      .sort(compareText);
    return {
      ...test,
      topKeys: topKeys.map((k) => ({ ...k })) as TestCost['topKeys'],
      violatedKeys: violated.slice(0, MAX_VIOLATED_KEYS) as TestCost['violatedKeys'],
      violatedKeyCount: violated.length,
    };
  });
  return {
    tests,
    omitted: breakdown.omitted,
    waterfalls: structuredClone(breakdown.waterfalls) as NonNullable<
      RunReport['testBreakdown']
    >['waterfalls'],
  };
}

/**
 * Builds the run report from the results of the run. Pure; applies rounding (02-REQ-07),
 * ordering (02-REQ-20) and the raw URL policy (02-REQ-16), and adds check.usage (11-REQ-30),
 * hints (11-REQ-34) and testBreakdown.tests[].violated* (08-REQ-37). Every aggregate must have
 * exactly one evaluation; a mismatch is a programming error and throws.
 */
export function buildRunReport(input: RunReportInput): RunReport {
  const { meta, aggregates, evaluation } = input;
  const rawUrls = input.config.report?.rawUrls === true;
  const kindOrder: Record<Kind, number> = { api: 0 };
  // The snapshot is complete in a real run; a sparse one falls back to the defaults (03).
  const hintOptions: HintOptions = {
    errorStatuses: input.config.checks?.errors?.statuses ?? perfDefaults.checks.errors.statuses,
    hardLimitFactor:
      input.config.gate?.hardLimitFactor === undefined
        ? perfDefaults.gate.hardLimitFactor
        : input.config.gate.hardLimitFactor,
  };
  const endpoints = buildAggregates(
    'api',
    aggregates.endpoints,
    evaluation.perKey.api,
    rawUrls,
    hintOptions,
  );
  return {
    schemaVersion: SCHEMA_VERSIONS.runReport,
    tool: { ...meta.tool },
    runId: meta.runId,
    mode: meta.mode,
    startedAt: meta.startedAt,
    finishedAt: meta.finishedAt,
    env: meta.env,
    configDir: meta.configDir,
    config: structuredClone(input.config),
    normalization: input.normalization,
    ci: meta.ci === null ? null : { ...meta.ci },
    host: { ...meta.host },
    playwright: { ...meta.playwright },
    runConditions: structuredClone(input.runConditions),
    tests: { ...input.tests },
    evaluation: {
      status: evaluation.status,
      gateEnabled: evaluation.gateEnabled,
      counts: structuredClone(evaluation.counts),
    },
    thresholdFiles: evaluation.thresholdFiles
      .map((file) => ({
        ...file,
        generated: file.generated === null ? null : structuredClone(file.generated),
        unseenKeys: [...file.unseenKeys].sort(compareText),
      }))
      .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind]),
    warnings: collapseIssues(input.warnings),
    toolErrors: collapseIssues(input.toolErrors),
    origins: aggregates.origins
      .map((o) => ({ ...o }))
      .sort((a, b) => compareText(a.origin, b.origin)),
    endpoints,
    testBreakdown: buildTestBreakdown(aggregates.testBreakdown, endpoints),
  };
}
