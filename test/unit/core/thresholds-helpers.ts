// Test helpers for the thresholds derivation and diff (10): run reports from compact aggregates,
// loaded thresholds files and the golden cases under test/golden/derive/ and test/golden/diff/.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PerfConfigInput, ResolvedConfig } from '../../../src/core/config/index.ts';
import type { LoadedThresholds, LoadedThresholdsFile } from '../../../src/core/evaluate/index.ts';
import type { DeriveOptions } from '../../../src/core/thresholds/index.ts';
import type {
  Aggregate,
  AggregateStats,
  Generated,
  KeyEvaluation,
  Kind,
  RunReport,
  ThresholdsEntry,
  ThresholdsFile,
} from '../../../src/core/types/index.ts';
import { GOLDEN_DIR } from '../../contract/golden.ts';
import { aggregate, config } from './evaluate-helpers.ts';
import type { AggregateSpec } from './evaluate-helpers.ts';

/**
 * Compact aggregate of a report: AggregateSpec, optionally with the report's percentiles stated
 * explicitly (10-REQ-01 takes them from stats.percentiles) and the error count of N.
 */
export interface ReportAggregateSpec extends AggregateSpec {
  percentiles?: Record<string, number>;
}

const NO_EVALUATION: KeyEvaluation = {
  result: 'not-evaluated',
  reason: 'no-rules',
  thresholdSource: 'default',
  limits: {
    t: null,
    median: 2000,
    percentile: 2000,
    p99: 4000,
    minApdex: null,
    maxWilson: null,
    maxErrorRate: 0.05,
  },
  checks: [],
  muted: null,
};

export function reportAggregate(spec: ReportAggregateSpec, level = 'p95'): Aggregate {
  const stats: AggregateStats = aggregate(spec, level);
  if (spec.percentiles !== undefined && stats.stats !== null) {
    stats.stats = { ...stats.stats, percentiles: { ...spec.percentiles } };
  }
  return { ...stats, evaluation: structuredClone(NO_EVALUATION), hints: [] };
}

export interface ReportSpec {
  endpoints?: Record<string, ReportAggregateSpec>;
  level?: string;
  runId?: string;
  startedAt?: string;
  mode?: RunReport['mode'];
  env?: string | null;
  tests?: Partial<RunReport['tests']>;
  toolErrors?: RunReport['toolErrors'];
  playwrightVersion?: string;
  host?: Partial<RunReport['host']>;
  normalization?: string;
  projects?: RunReport['runConditions']['projects'];
}

export const HOST: RunReport['host'] = {
  platform: 'linux',
  arch: 'x64',
  nodeVersion: 'v22.18.0',
  ci: true,
  cpuCount: 4,
  cpuModel: 'AMD EPYC 7763',
};

/** A valid run report of a thresholds run with the given aggregates. */
export function runReport(spec: ReportSpec = {}): RunReport {
  const level = spec.level ?? 'p95';
  const expand = (specs: Record<string, ReportAggregateSpec> = {}): Record<string, Aggregate> =>
    Object.fromEntries(Object.entries(specs).map(([key, s]) => [key, reportAggregate(s, level)]));
  const counts = {
    keys: 0,
    fromFile: 0,
    fromDefaults: 0,
    notEvaluated: 0,
    tooFewSamples: 0,
    fileEntriesNotEvaluated: 0,
    medianOnly: 0,
    unseenThresholdEntries: 0,
    violations: 0,
    blockingViolations: 0,
    muted: 0,
  };
  return {
    schemaVersion: 3,
    tool: { name: 'playwright-performance-regression', version: '0.1.0' },
    runId: spec.runId ?? 'run-1',
    mode: spec.mode ?? 'thresholds',
    startedAt: spec.startedAt ?? '2026-11-18T10:00:00.000Z',
    finishedAt: '2026-11-18T10:05:00.000Z',
    env: spec.env === undefined ? null : spec.env,
    configDir: '/home/user/project',
    config: {},
    normalization: spec.normalization ?? '0a3f9c21d47b6e',
    ci: null,
    host: { ...HOST, ...spec.host },
    playwright: { version: spec.playwrightVersion ?? '1.57.0' },
    runConditions: {
      workers: 1,
      projects: spec.projects ?? [
        {
          name: 'chromium',
          role: 'measured',
          browserName: 'chromium',
          repeatEach: 10,
          retries: 0,
        },
      ],
      overriddenSettings: [],
    },
    tests: { status: 'passed', expected: 10, unexpected: 0, flaky: 0, skipped: 0, ...spec.tests },
    evaluation: {
      status: 'passed',
      gateEnabled: false,
      counts: { api: { ...counts } },
    },
    thresholdFiles: [],
    warnings: [],
    toolErrors: spec.toolErrors ?? [],
    origins: [],
    endpoints: expand(spec.endpoints),
    testBreakdown: { tests: [], omitted: 0, waterfalls: [] },
  };
}

export const OPTIONS: DeriveOptions = { env: null, prune: false, toolVersion: '0.1.0' };

export function deriveOptions(partial: Partial<DeriveOptions> = {}): DeriveOptions {
  return { ...OPTIONS, ...partial };
}

/** generated block of a file derived from runReport() with the default config. */
export function generated(partial: Partial<Generated> = {}): Generated {
  return {
    tool: { name: 'playwright-performance-regression', version: '0.1.0' },
    env: null,
    sourceRunId: 'run-0',
    sourceRunStartedAt: '2026-11-17T10:00:00.000Z',
    sourceSampleCount: 100,
    evaluatedPercentile: 'p95',
    derivation: {
      t: { min: 500, max: 2000, medianFactor: 2 },
      smallSampleN: 20,
      margins: {
        median: { relative: 0.4, minMs: 100, smallSampleRelative: 0.8 },
        percentile: { relative: 0.4, minMs: 100, smallSampleRelative: 0.8 },
        p99: { relative: 0.2, minGapMs: 50, minGapRelative: 0.1 },
        apdex: { absolute: 0.05, smallSampleAbsolute: 0.1 },
        wilson: { factor: 1.5, add: 0.02, min: 0.03, max: 0.15, smallSampleMin: 0.1 },
        errors: { factor: 1.5, add: 0.02, min: 0.05 },
      },
    },
    browsers: ['chromium'],
    playwrightVersion: '1.57.0',
    host: { platform: 'linux', arch: 'x64', ci: true, cpuCount: 4, cpuModel: 'AMD EPYC 7763' },
    normalization: '0a3f9c21d47b6e',
    ...partial,
  };
}

export function file(
  kind: Kind,
  entries: Record<string, ThresholdsEntry> = {},
  gen: Generated | null = generated(),
): LoadedThresholdsFile {
  return {
    status: 'loaded',
    kind,
    path: `pw-perf-thresholds.${kind}.json`,
    file: { schemaVersion: 2, kind, generated: gen, entries },
  };
}

export function absent(kind: Kind): LoadedThresholdsFile {
  return {
    status: 'missing',
    kind,
    path: `pw-perf-thresholds.${kind}.json`,
    envlessFileExists: false,
  };
}

export function existing(api: LoadedThresholdsFile = absent('api')): LoadedThresholds {
  return { api };
}

export function cfg(input: PerfConfigInput = {}): ResolvedConfig {
  return config(input);
}

/** Golden case of test/golden/derive/ or test/golden/diff/ (12-REQ-14, 12-REQ-15). */
export interface ThresholdsGoldenCase {
  file: string;
  name: string;
  description: string;
  input: {
    config: PerfConfigInput;
    options: Partial<DeriveOptions>;
    report: ReportSpec;
    existing: { api: LoadedThresholdsFile | null };
  };
  expected: unknown;
}

export const DERIVE_GOLDEN_DIR = join(GOLDEN_DIR, 'derive');
export const DIFF_GOLDEN_DIR = join(GOLDEN_DIR, 'diff');

export function loadThresholdsCases(dir: string): ThresholdsGoldenCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      file: f,
      ...(JSON.parse(readFileSync(join(dir, f), 'utf8')) as Omit<ThresholdsGoldenCase, 'file'>),
    }));
}

export function goldenExisting(c: ThresholdsGoldenCase): LoadedThresholds {
  return existing(c.input.existing.api ?? absent('api'));
}

/** A loaded thresholds file with the given content, e.g. the result of an earlier derivation. */
export function loadedFile(content: ThresholdsFile, migratedFrom?: number): LoadedThresholdsFile {
  return {
    status: 'loaded',
    kind: content.kind,
    path: `pw-perf-thresholds.${content.kind}.json`,
    file: structuredClone(content),
    ...(migratedFrom === undefined ? {} : { migratedFrom }),
  };
}
