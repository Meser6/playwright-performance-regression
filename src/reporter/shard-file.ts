// Shard files (17, chapter 6): a perf-mode run with --shard=i/n does not evaluate; it writes the
// inputs of its aggregator for all passes, the counters of the end-of-run warnings and what the
// merge needs to finish the run to <report.dir>/shard-<i>-of-<n>.json. An internal format like the
// pass file (17-REQ-10): written and read by the same package version, no schema file and no
// migration. Pure.
import type { ResolvedConfigJson } from '../core/config/index.ts';
import type { Issue, RunReport } from '../core/types/index.ts';
import type { RunConditionsReport } from './begin.ts';
import type { PassCounters, PassEntry, TestCounts } from './pass-file.ts';

export const SHARD_FILE_FORMAT = 'pw-perf-shard';
export const SHARD_FILE_VERSION = 1;

/** File name of shard i of n in report.dir (17-REQ-05). */
export function shardFileName(shard: { current: number; total: number }): string {
  return `shard-${String(shard.current)}-of-${String(shard.total)}.json`;
}

/** shard-<i>-of-<n>.json names, for the merge (17-REQ-13). */
export function isShardFileName(name: string): boolean {
  return /^shard-[1-9][0-9]*-of-[1-9][0-9]*\.json$/u.test(name);
}

export interface ShardFile {
  format: typeof SHARD_FILE_FORMAT;
  schemaVersion: typeof SHARD_FILE_VERSION;
  toolVersion: string;
  playwrightVersion: string;
  shard: { current: number; total: number };
  runId: string;
  mode: 'test' | 'thresholds';
  env: string | null;
  prune: boolean;
  /** The Playwright arguments selected a subset of the tests (04-REQ-35); --shard does not count. */
  testFilter: boolean;
  /** FullConfig.maxFailures of the shard; Playwright applies it per shard (17-REQ-15). */
  maxFailures: number;
  /** Relative to the working directory of the Playwright process, with "/" (17-REQ-10). */
  paths: { configDir: string; configFile: string; reportDir: string };
  config: ResolvedConfigJson;
  normalization: string;
  stepNormalization: string | null;
  /** Measured projects and dependency or teardown projects, for the aggregator of the merge. */
  projects: { measured: string[]; dependencies: string[] };
  startedAt: string;
  finishedAt: string;
  status: RunReport['tests']['status'];
  passes: RunReport['passes'];
  host: RunReport['host'];
  ci: RunReport['ci'];
  runConditions: RunConditionsReport;
  tests: TestCounts;
  counters: PassCounters;
  /** Warnings and tool errors of onBegin of pass 1 (config, run conditions). */
  beginWarnings: Issue[];
  beginToolErrors: Issue[];
  /** Warnings and tool errors collected later in all passes of the shard. */
  warnings: Issue[];
  toolErrors: Issue[];
  entries: PassEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const REQUIRED: readonly (keyof ShardFile)[] = [
  'toolVersion',
  'playwrightVersion',
  'shard',
  'runId',
  'mode',
  'env',
  'prune',
  'testFilter',
  'maxFailures',
  'paths',
  'config',
  'normalization',
  'stepNormalization',
  'projects',
  'startedAt',
  'finishedAt',
  'status',
  'passes',
  'host',
  'ci',
  'runConditions',
  'tests',
  'counters',
  'beginWarnings',
  'beginToolErrors',
  'warnings',
  'toolErrors',
  'entries',
];

/**
 * A shard file, or the reason it is not accepted (17-REQ-14, MERGE_SHARD_INVALID): no valid JSON,
 * another format or version, or missing fields. The package version is compared across the set
 * (MERGE_SHARD_MISMATCH).
 */
export function parseShardFile(
  text: string,
): { ok: true; value: ShardFile } | { ok: false; reason: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'the file is not valid JSON' };
  }
  if (!isRecord(value) || value.format !== SHARD_FILE_FORMAT) {
    return { ok: false, reason: 'the file is no shard file' };
  }
  if (value.schemaVersion !== SHARD_FILE_VERSION) {
    return {
      ok: false,
      reason: `the file has version ${JSON.stringify(value.schemaVersion)} of the shard format, expected ${String(SHARD_FILE_VERSION)}`,
    };
  }
  const missing = REQUIRED.filter((name) => !Object.hasOwn(value, name));
  if (missing.length > 0) {
    return { ok: false, reason: `fields are missing: ${missing.join(', ')}` };
  }
  const shard = value.shard;
  if (
    !isRecord(shard) ||
    !Number.isInteger(shard.current) ||
    !Number.isInteger(shard.total) ||
    (shard.current as number) < 1 ||
    (shard.current as number) > (shard.total as number)
  ) {
    return { ok: false, reason: 'the shard number is not valid' };
  }
  if (
    !Array.isArray(value.entries) ||
    !isRecord(value.tests) ||
    !isRecord(value.counters) ||
    !isRecord(value.paths) ||
    !isRecord(value.projects) ||
    !Array.isArray(value.warnings) ||
    !Array.isArray(value.toolErrors) ||
    !Array.isArray(value.beginWarnings) ||
    !Array.isArray(value.beginToolErrors)
  ) {
    return { ok: false, reason: 'the file is incomplete' };
  }
  return { ok: true, value: value as unknown as ShardFile };
}
