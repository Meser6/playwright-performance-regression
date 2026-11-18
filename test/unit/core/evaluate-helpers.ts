// Test helpers for the evaluation (09): compact aggregates, config, options and the golden cases
// under test/golden/evaluate/.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveConfig } from '../../../src/core/config/index.ts';
import type { PerfConfigInput, ResolvedConfig } from '../../../src/core/config/index.ts';
import { evaluate } from '../../../src/core/evaluate/index.ts';
import type {
  EvaluateOptions,
  Evaluation,
  LoadedThresholds,
  LoadedThresholdsFile,
} from '../../../src/core/evaluate/index.ts';
import { roundMs } from '../../../src/core/format/index.ts';
import { percentile, percentileNames } from '../../../src/core/stats/index.ts';
import type {
  AggregateStats,
  Kind,
  ThresholdsEntry,
  ThresholdsFile,
} from '../../../src/core/types/index.ts';
import { GOLDEN_DIR } from '../../contract/golden.ts';

/**
 * Compact form of an aggregate: `durations` as runs of [count, ms] of successful samples,
 * `errors` error samples (status 500) and `other` samples that are neither (status 404).
 */
export interface AggregateSpec {
  durations?: [number, number][];
  errors?: number;
  other?: number;
}

/** Expands a compact aggregate into AggregateStats as the aggregator (08) builds it. */
export function aggregate(spec: AggregateSpec, level = 'p95'): AggregateStats {
  const durations = (spec.durations ?? [])
    .flatMap(([count, ms]) => Array.from({ length: count }, () => ms))
    .sort((a, b) => a - b);
  const errors = spec.errors ?? 0;
  const other = spec.other ?? 0;
  const n = durations.length;
  const statuses: Record<string, number> = {};
  if (n > 0) statuses['200'] = n;
  if (other > 0) statuses['404'] = other;
  if (errors > 0) statuses['500'] = errors;
  return {
    count: n + errors + other,
    successCount: n,
    errorCount: errors,
    fromFailedTests: 0,
    testCount: 1,
    statuses,
    timeSources: { browser: n + errors + other, node: 0 },
    stats:
      n === 0
        ? null
        : {
            min: durations[0] ?? 0,
            avg: roundMs(durations.reduce((a, b) => a + b, 0) / n),
            max: durations[n - 1] ?? 0,
            percentiles: Object.fromEntries(
              percentileNames(level).map(([name, p]) => [
                name,
                roundMs(percentile(durations, p) ?? 0),
              ]),
            ),
          },
    ttfb: null,
    slowest: [],
    topTests: [],
    samples: { durations, sampled: false },
  };
}

export function config(input: PerfConfigInput = {}): ResolvedConfig {
  const result = resolveConfig(input, {});
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value.config;
}

export const SOURCE: EvaluateOptions['source'] = {
  browsers: ['chromium'],
  playwrightVersion: '1.57.0',
  host: { platform: 'linux', arch: 'x64', ci: true, cpuCount: 4, cpuModel: 'AMD EPYC 7763' },
  normalization: '0a3f9c21d47b6e',
};

export function options(partial: Partial<EvaluateOptions> = {}): EvaluateOptions {
  return {
    mode: 'test',
    env: null,
    fatalToolError: false,
    source: SOURCE,
    startedAt: '2026-11-18T10:00:00.000Z',
    ...partial,
  };
}

export function thresholdsFile(
  kind: Kind,
  entries: Record<string, ThresholdsEntry>,
  generated: ThresholdsFile['generated'] = null,
): ThresholdsFile {
  return { schemaVersion: 1, kind, generated, entries };
}

export function loaded(
  kind: Kind,
  entries: Record<string, ThresholdsEntry> = {},
  generated: ThresholdsFile['generated'] = null,
): LoadedThresholdsFile {
  return {
    status: 'loaded',
    kind,
    path: `perf-thresholds.${kind}.json`,
    file: thresholdsFile(kind, entries, generated),
  };
}

export function missing(kind: Kind, envlessFileExists = false, env?: string): LoadedThresholdsFile {
  const label = env === undefined ? '' : `.${env}`;
  return {
    status: 'missing',
    kind,
    path: `perf-thresholds.${kind}${label}.json`,
    envlessFileExists,
  };
}

export function invalid(kind: Kind): LoadedThresholdsFile {
  const path = `perf-thresholds.${kind}.json`;
  return {
    status: 'invalid',
    kind,
    path,
    issues: [
      {
        code: 'SCHEMA_INVALID_JSON',
        source: path,
        message: `${path}: not valid JSON`,
        problems: [],
      },
    ],
  };
}

export function both(
  api: LoadedThresholdsFile = loaded('api'),
  custom: LoadedThresholdsFile = loaded('custom'),
): LoadedThresholds {
  return { api, custom };
}

export function aggregates(
  endpoints: Record<string, AggregateSpec>,
  custom: Record<string, AggregateSpec> = {},
  level = 'p95',
): { endpoints: Record<string, AggregateStats>; custom: Record<string, AggregateStats> } {
  const expand = (specs: Record<string, AggregateSpec>) =>
    Object.fromEntries(Object.entries(specs).map(([key, s]) => [key, aggregate(s, level)]));
  return { endpoints: expand(endpoints), custom: expand(custom) };
}

/** One golden case of test/golden/evaluate/ (12-REQ-15). */
export interface EvaluateGoldenCase {
  file: string;
  name: string;
  description: string;
  input: {
    config: PerfConfigInput;
    options: Partial<EvaluateOptions>;
    thresholds: LoadedThresholds;
    aggregates: { endpoints: Record<string, AggregateSpec>; custom: Record<string, AggregateSpec> };
  };
  expected: EvaluationSummary;
}

export const EVALUATE_GOLDEN_DIR = join(GOLDEN_DIR, 'evaluate');

export function loadEvaluateCases(): EvaluateGoldenCase[] {
  return readdirSync(EVALUATE_GOLDEN_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({
      file,
      ...(JSON.parse(readFileSync(join(EVALUATE_GOLDEN_DIR, file), 'utf8')) as Omit<
        EvaluateGoldenCase,
        'file'
      >),
    }));
}

export function runGoldenCase(c: EvaluateGoldenCase): {
  evaluation: Evaluation;
  cfg: ResolvedConfig;
} {
  const cfg = config(c.input.config);
  const level = cfg.checks.time.percentile.level;
  const evaluation = evaluateInput(c, cfg, level);
  return { evaluation, cfg };
}

function evaluateInput(c: EvaluateGoldenCase, cfg: ResolvedConfig, level: string): Evaluation {
  return evaluate(
    aggregates(c.input.aggregates.endpoints, c.input.aggregates.custom, level),
    c.input.thresholds,
    cfg,
    options(c.input.options),
  );
}

/** The part of an Evaluation a golden case states: gate result, counters, violations, issues. */
export interface EvaluationSummary {
  status: Evaluation['status'];
  gateEnabled: boolean;
  counts: Evaluation['counts'];
  violations: {
    kind: Kind;
    key: string;
    rule: string;
    actual: number;
    limit: number;
    hardLimitExceeded: boolean;
    blocking: boolean;
  }[];
  notEvaluated: { kind: Kind; key: string; reason: string | null }[];
  warnings: string[];
  toolErrors: string[];
}

export function summarize(evaluation: Evaluation): EvaluationSummary {
  const kinds: Kind[] = ['api', 'custom'];
  return {
    status: evaluation.status,
    gateEnabled: evaluation.gateEnabled,
    counts: evaluation.counts,
    violations: kinds.flatMap((kind) =>
      Object.entries(evaluation.perKey[kind]).flatMap(([key, e]) =>
        e.checks
          .filter((c) => !c.passed)
          .map((c) => ({
            kind,
            key,
            rule: c.rule,
            actual: c.actual,
            limit: c.limit,
            hardLimitExceeded: c.hardLimitExceeded,
            blocking: c.blocking,
          })),
      ),
    ),
    notEvaluated: kinds.flatMap((kind) =>
      Object.entries(evaluation.perKey[kind])
        .filter(([, e]) => e.result === 'not-evaluated')
        .map(([key, e]) => ({ kind, key, reason: e.reason })),
    ),
    warnings: evaluation.warnings.map((w) => w.code),
    toolErrors: evaluation.toolErrors.map((w) => w.code),
  };
}

/**
 * Compact JSON of the golden files: a value whose one-line form fits in 140 columns stays on
 * one line, so an aggregate or a violation is one line.
 */
export function compactJson(value: unknown, indent = ''): string {
  const flat = JSON.stringify(value);
  if (value === null || typeof value !== 'object' || flat.length + indent.length <= 140) {
    return flat;
  }
  const next = `${indent}  `;
  if (Array.isArray(value)) {
    return `[\n${value.map((v) => next + compactJson(v, next)).join(',\n')}\n${indent}]`;
  }
  const body = Object.entries(value)
    .map(([k, v]) => `${next}${JSON.stringify(k)}: ${compactJson(v, next)}`)
    .join(',\n');
  return `{\n${body}\n${indent}}`;
}
