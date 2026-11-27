// The shard merge (17, chapter 7; ADR-0013): `PW_PERF_MODE=merge npx pw-perf` reads the shard
// files from the default report folder, checks the set (17-REQ-14) and finishes the run in one
// session like the first pass of a run without shards (17-REQ-15). validateShardSet is pure;
// runMerge takes files, clock and terminal from the ReporterHost.
import { resolveConfig } from '../core/config/index.ts';
import { stringifyStable } from '../core/format/index.ts';
import { collapseIssues } from '../core/report/index.ts';
import { SCHEMA_VERSIONS } from '../core/schema/index.ts';
import { PACKAGE_NAME } from '../core/types/index.ts';
import type { Issue, Outcome } from '../core/types/index.ts';
import { asciiTerminal } from '../console/box.ts';
import { colorEnabled } from '../console/color.ts';
import { mergeOutcomeLine } from '../console/shard-summary.ts';
import { issueBox } from '../console/summary.ts';
import { generateRunId, mergeIgnoredEnv } from '../mode/index.ts';
import type { ModeEnv } from '../mode/index.ts';
import { MERGE_DIR, RunSession } from './session.ts';
import type { MergeInput, RunSettings } from './session.ts';
import { worseStatus } from './pass-file.ts';
import { isShardFileName, parseShardFile } from './shard-file.ts';
import type { ShardFile } from './shard-file.ts';
import type { ReporterHost } from './types.ts';

/** Fields that must be equal in every shard file (17-REQ-14, 17-REQ-27). */
const EQUAL_FIELDS = [
  'toolVersion',
  'playwrightVersion',
  'mode',
  'env',
  'total',
  'config',
  'normalization',
  'stepNormalization',
  'paths',
] as const;

type EqualField = (typeof EQUAL_FIELDS)[number];

function fieldValue(file: ShardFile, field: EqualField): string {
  return stringifyStable(field === 'total' ? file.shard.total : file[field]);
}

const FIELD_NAMES: Record<EqualField, string> = {
  toolVersion: 'package version',
  playwrightVersion: 'Playwright version',
  mode: 'mode',
  env: 'environment label',
  total: 'number of shards',
  config: 'package config',
  normalization: 'normalization',
  stepNormalization: 'step normalization',
  paths: 'paths',
};

export interface ShardSetInput {
  /** Shard file names of the merge folder and their text; null for an unreadable file. */
  files: readonly { name: string; text: string | null }[];
  /** Environment of the merge process (MERGE_ENV_IGNORED). */
  env: ModeEnv;
  /** Whether paths.configDir with paths.configFile exists below the working directory. */
  configFound(paths: ShardFile['paths']): boolean;
}

/** Result of the validation (17-REQ-14). */
export type ShardSet =
  | { kind: 'none'; toolErrors: Issue[] }
  | {
      kind: 'fatal';
      mode: 'test' | 'thresholds' | null;
      status: Outcome['tests']['status'];
      toolErrors: Issue[];
    }
  | {
      kind: 'ok';
      shards: ShardFile[];
      total: number;
      missing: number[];
      warnings: Issue[];
      toolErrors: Issue[];
    };

function list(items: readonly (string | number)[]): string {
  return items.map(String).join(', ');
}

/** Checks the shard files of a merge (17-REQ-14); every row of its table is one branch here. */
export function validateShardSet(input: ShardSetInput): ShardSet {
  const named = input.files.filter((f) => isShardFileName(f.name));
  if (named.length === 0) {
    return {
      kind: 'none',
      toolErrors: [
        {
          code: 'MERGE_NO_SHARD_FILES',
          message: `No shard files (shard-<i>-of-<n>.json) were found in ${MERGE_DIR}/.`,
          hint: `Download the shard-*.json files of all shard jobs to ${MERGE_DIR}/ and run the merge from the directory where the shards ran the test command.`,
        },
      ],
    };
  }
  const toolErrors: Issue[] = [];
  const warnings: Issue[] = [];
  const valid: { name: string; file: ShardFile }[] = [];
  for (const { name, text } of [...named].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const parsed =
      text === null
        ? { ok: false as const, reason: 'the file could not be read' }
        : parseShardFile(text);
    if (!parsed.ok) {
      toolErrors.push({
        code: 'MERGE_SHARD_INVALID',
        message: `${name} was skipped: ${parsed.reason}.`,
        hint: 'Use the shard files written by the shard jobs of this run, unchanged.',
      });
      continue;
    }
    valid.push({ name, file: parsed.value });
  }
  if (valid.length === 0) return { kind: 'fatal', mode: null, status: 'failed', toolErrors };
  valid.sort((a, b) => a.file.shard.current - b.file.shard.current || (a.name < b.name ? -1 : 1));
  const first = valid[0] as { name: string; file: ShardFile };
  const mode = first.file.mode;
  const status = valid.reduce<Outcome['tests']['status']>(
    (worst, v) => worseStatus(worst, v.file.status),
    'passed',
  );

  for (const field of EQUAL_FIELDS) {
    const groups = new Map<string, string[]>();
    for (const { name, file } of valid) {
      const value = fieldValue(file, field);
      groups.set(value, [...(groups.get(value) ?? []), name]);
    }
    if (groups.size > 1) {
      const parts = [...groups.values()].map((names) => list(names));
      toolErrors.push({
        code: 'MERGE_SHARD_MISMATCH',
        message: `The shard files differ in the ${FIELD_NAMES[field]} (${field}): ${parts.join(' vs ')}.`,
        hint: 'Merge the shard files of one run: the same package version, mode, config and number of shards on every machine.',
      });
      return { kind: 'fatal', mode, status, toolErrors };
    }
  }

  const byIndex = new Map<number, string[]>();
  for (const { name, file } of valid) {
    byIndex.set(file.shard.current, [...(byIndex.get(file.shard.current) ?? []), name]);
  }
  const duplicates = [...byIndex].filter(([, names]) => names.length > 1);
  if (duplicates.length > 0) {
    for (const [index, names] of duplicates) {
      toolErrors.push({
        code: 'MERGE_SHARD_DUPLICATE',
        message: `Shard ${String(index)} has more than one file: ${list(names)}.`,
        hint: `Keep one file per shard in ${MERGE_DIR}/; remove the files of earlier runs.`,
      });
    }
    return { kind: 'fatal', mode, status, toolErrors };
  }

  if (!input.configFound(first.file.paths)) {
    const { configDir, configFile } = first.file.paths;
    toolErrors.push({
      code: 'MERGE_WRONG_DIRECTORY',
      message: `The Playwright config of the shards (${configDir === '.' ? '' : `${configDir}/`}${configFile}) is not below the working directory.`,
      hint: 'Run the merge from the directory where the shards ran the test command (in CI: the root of the checkout).',
    });
    return { kind: 'fatal', mode, status, toolErrors };
  }

  const shards = valid.map((v) => v.file);
  const total = first.file.shard.total;
  const missing = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !byIndex.has(n));
  if (missing.length > 0) {
    toolErrors.push({
      code: 'MERGE_SHARD_MISSING',
      message: `${missing.length === 1 ? 'Shard' : 'Shards'} ${missing.map((n) => `${String(n)}/${String(total)}`).join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing; the report covers the other shards only.`,
      hint: `Check the shard jobs; every shard must upload ${MERGE_DIR}/shard-*.json, also when it failed.`,
    });
  }

  const commits = new Set(shards.flatMap((s) => (s.ci?.commit == null ? [] : [s.ci.commit])));
  if (commits.size > 1) {
    warnings.push({
      code: 'MERGE_SHARDS_DIFFERENT_COMMIT',
      message: `The shards ran on ${String(commits.size)} different commits: ${list([...commits].map((c) => c.slice(0, 7)).sort())}.`,
      hint: 'Merge the shard files of one pipeline run; shards of different commits measure different code.',
    });
  }
  const hosts = new Set(
    shards.map((s) => {
      const { nodeVersion: _, ...host } = s.host;
      return stringifyStable(host);
    }),
  );
  if (hosts.size > 1) {
    warnings.push({
      code: 'MERGE_SHARDS_DIFFERENT_HOSTS',
      message: `The shards ran on ${String(hosts.size)} different kinds of machines; differences between machines add noise to the statistics.`,
      hint: 'Run all shards on the same machine type, and derive the thresholds with the same number of shards and machine type as the measurement.',
    });
  }

  const ignored = mergeIgnoredEnv(input.env);
  const differs: string[] = [];
  if (ignored.env !== undefined && ignored.env !== (first.file.env ?? undefined)) {
    differs.push(`PW_PERF_ENV=${ignored.env}`);
  }
  if (ignored.prune !== undefined && (ignored.prune === '1') !== first.file.prune) {
    differs.push(`PW_PERF_PRUNE=${ignored.prune}`);
  }
  if (ignored.passes !== undefined && ignored.passes !== String(first.file.passes.planned)) {
    differs.push(`PW_PERF_PASSES=${ignored.passes}`);
  }
  if (differs.length > 0) {
    warnings.push({
      code: 'MERGE_ENV_IGNORED',
      message: `${differs.join(', ')} ${differs.length === 1 ? 'was' : 'were'} ignored: the merge uses the values of the shard files.`,
      hint: 'Set these variables for the test command of the shard jobs, not for the merge job.',
    });
  }
  return { kind: 'ok', shards, total, missing, warnings, toolErrors };
}

function internalError(error: unknown): Issue {
  return {
    code: 'MERGE_INTERNAL_ERROR',
    message: `Unexpected error in the merge: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    hint: 'This is a bug in the package; please report it with the message above.',
  };
}

/** Settings of the merge: the config snapshot and mode of the shard files (17-D-05). */
function mergeSettings(first: ShardFile, packageVersion: string): RunSettings {
  const resolved = resolveConfig(first.config as never, { source: 'snapshot' });
  if (!resolved.ok) {
    throw new Error(
      `the config snapshot of the shard files is not valid: ${resolved.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return {
    config: resolved.value.config,
    // Byte for byte the snapshot of the shards (02-REQ-17).
    snapshot: first.config,
    mode: {
      mode: first.mode,
      ...(first.env === null ? {} : { env: first.env }),
      ...(first.prune ? { prune: true } : {}),
    },
    packageVersion,
    measuredProjects: first.projects.measured,
    runConditions: { overridden: [], removedReporters: [], replacedReporters: [] },
    registered: false,
    warnings: [],
    toolErrors: [],
  };
}

/**
 * Runs the merge in the working directory of `host` (17-REQ-12…20) and returns the exit code:
 * 0, 2 or 3 from the outcome (17-REQ-20).
 */
export async function runMerge(host: ReporterHost, packageVersion: string): Promise<number> {
  const io = host.io;
  const dir = io.resolvePath(host.cwd, MERGE_DIR);
  const outcomePath = io.resolvePath(dir, 'outcome.json');
  const out = host.stdout;
  const frame = {
    width: out.isTTY === true && out.columns !== undefined && out.columns > 0 ? out.columns : 120,
    color: colorEnabled(out, host.env),
    ascii: asciiTerminal(host.env),
  };
  let mode: 'test' | 'thresholds' | null = null;
  let status: Outcome['tests']['status'] = 'failed';
  try {
    // The outcome of an earlier run must never be read by a CI job (04-REQ-62).
    try {
      io.removeFileSync(outcomePath);
    } catch {
      // Overwritten below, or there is none.
    }
    const files = await Promise.all(
      io
        .listDirSync(dir)
        .filter(isShardFileName)
        .map(async (name) => {
          let text: string | null;
          try {
            text = await io.readTextFile(io.resolvePath(dir, name));
          } catch {
            text = null;
          }
          return { name, text };
        }),
    );
    const set = validateShardSet({
      files,
      env: host.env,
      configFound: (paths) => {
        const configDir = io.resolvePath(host.cwd, paths.configDir);
        if (!io.isDirectorySync(configDir)) return false;
        return paths.configFile === '' || io.listDirSync(configDir).includes(paths.configFile);
      },
    });
    if (set.kind !== 'ok') {
      if (set.kind === 'fatal') {
        mode = set.mode;
        status = set.status;
      }
      return await fail(set.toolErrors);
    }
    const first = set.shards[0] as ShardFile;
    mode = first.mode;
    const input: MergeInput = {
      shards: set.shards,
      total: set.total,
      missing: set.missing,
      configDir: io.resolvePath(host.cwd, first.paths.configDir),
      warnings: set.warnings,
      toolErrors: set.toolErrors,
    };
    const session = new RunSession(host, mergeSettings(first, packageVersion));
    return await session.merge(input);
  } catch (error) {
    return await fail([internalError(error)]);
  }

  /** No evaluation: the errors, and outcome.json with exit code 3 when the mode is known. */
  async function fail(toolErrors: Issue[]): Promise<number> {
    const issues = collapseIssues(toolErrors);
    host.stderr.write(`${issueBox('error', issues, Infinity, frame).join('\n')}\n`);
    if (mode === null) {
      host.stdout.write(`Outcome: merge not started (code 3)\n`);
      return 3;
    }
    const outcome: Outcome = {
      schemaVersion: SCHEMA_VERSIONS.outcome,
      runId: generateRunId(host.now(), host.random),
      mode,
      exitCode: 3,
      tests: { status },
      evaluation: { status: 'error', gateEnabled: mode === 'test' },
      toolErrors: issues,
      paths: { reportJson: null, reportHtml: null, thresholds: [], thresholdsDiff: null },
    };
    try {
      await io.writeJsonStable(outcomePath, outcome);
      host.stdout.write(mergeOutcomeLine(outcome, outcomePath));
    } catch (error) {
      host.stderr.write(
        `${PACKAGE_NAME}: OUTCOME_WRITE_FAILED: the outcome file could not be written to ${outcomePath}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    return 3;
  }
}
