// Assembly of the run report (02, chapters 7 and 9.1).
import { roundMs } from '../format/index.ts';
import { SCHEMA_VERSIONS } from '../schema/index.ts';
import type {
  AggregateStats,
  Issue,
  KeyEvaluation,
  Kind,
  RunReport,
  RunReportAggregate,
  SlowSample,
  ThresholdFileInfo,
} from '../types/index.ts';
import { collapseIssues } from './issues.ts';

/** The parts of the aggregation result (08) the report needs. */
export interface RunReportAggregates {
  endpoints: Record<string, AggregateStats>;
  custom: Record<string, AggregateStats>;
  origins: RunReport['origins'];
}

/** The parts of the evaluation result (09) the report needs; its warnings go to `warnings`. */
export interface RunReportEvaluation {
  status: RunReport['evaluation']['status'];
  gateEnabled: boolean;
  counts: RunReport['evaluation']['counts'];
  perKey: Record<Kind, Record<string, KeyEvaluation>>;
  thresholdFiles: ThresholdFileInfo[];
}

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
  evaluation: KeyEvaluation,
  rawUrls: boolean,
): RunReportAggregate {
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
      stats.ttfb === null ? null : { p50: roundMs(stats.ttfb.p50), p95: roundMs(stats.ttfb.p95) },
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
    evaluation: structuredClone(evaluation),
  };
}

function buildAggregates(
  kind: Kind,
  aggregates: Record<string, AggregateStats>,
  perKey: Record<string, KeyEvaluation>,
  rawUrls: boolean,
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
    result[key] = buildAggregate(stats, evaluation, rawUrls);
  }
  return result;
}

/**
 * Builds the run report from the results of the run. Pure; applies rounding (02-REQ-07),
 * ordering (02-REQ-20) and the raw URL policy (02-REQ-16). Every aggregate must have exactly
 * one evaluation; a mismatch is a programming error and throws.
 */
export function buildRunReport(input: RunReportInput): RunReport {
  const { meta, aggregates, evaluation } = input;
  const rawUrls = input.config.report?.rawUrls === true;
  const kindOrder: Record<Kind, number> = { api: 0, custom: 1 };
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
    endpoints: buildAggregates('api', aggregates.endpoints, evaluation.perKey.api, rawUrls),
    custom: buildAggregates('custom', aggregates.custom, evaluation.perKey.custom, rawUrls),
  };
}
