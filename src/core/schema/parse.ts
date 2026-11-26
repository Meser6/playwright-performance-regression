// Reading the file formats: JSON parsing, schemaVersion handling and migrations, validation
// (02, chapters 5 and 9.1). Errors are values (01-REQ-04).
import type {
  Issue,
  Kind,
  OutcomeFile,
  Result,
  RunReport,
  SampleBatch,
  ThresholdsFile,
} from '../types/index.ts';
import { DEFAULT_CONFIG } from '../config/generated/defaults.ts';
import { expandSteps } from '../config/steps.ts';
import { compileStatusMatcher } from '../stats/classification.ts';
import { child, isRecord, Sink } from './dsl.ts';
import type { Problem, Schema } from './dsl.ts';
import { outcomeFile, runReport, sampleBatch, thresholdsFile } from './formats.ts';

export type SchemaIssueCode =
  | 'SCHEMA_INVALID_JSON'
  | 'SCHEMA_VERSION_MISSING'
  | 'SCHEMA_VERSION_TOO_NEW'
  | 'SCHEMA_VERSION_MISMATCH'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'THRESHOLDS_KIND_MISMATCH';

export interface SchemaIssue {
  code: SchemaIssueCode;
  /** File path, or test title for an attachment. */
  source: string;
  /** English; names the source and lists the problems. */
  message: string;
  /** At most MAX_PROBLEMS entries (02, chapter 10). */
  problems: { pointer: string; message: string }[];
}

/** Problems listed per issue (02, chapter 10). */
export const MAX_PROBLEMS = 5;

/**
 * Current schemaVersion of every format. 02-REQ-11 applies from the first release: the run
 * report went to version 2 (02-REQ-30); removing custom measurements (D-32) moved the sample
 * batch to 2, the thresholds file to 2 and the run report to 3 (02-REQ-33); APIRequestContext
 * calls moved the sample batch to 3 (02-REQ-40); 1.1.0 moves the run report to 5, the
 * thresholds file to 3 and the sample batch to 4 (02-REQ-43).
 */
export const SCHEMA_VERSIONS = {
  samples: 4,
  runReport: 5,
  thresholds: 3,
  outcome: 1,
} as const;

type JsonObject = Record<string, unknown>;

/** Migration from version N (the key) to N + 1. */
export type Migrations = Readonly<Record<number, (document: JsonObject) => JsonObject>>;

export interface VersionedFormat {
  /** Human-readable name used in messages, e.g. "thresholds file". */
  name: string;
  /** Schema file in schemas/, named in hints. */
  schemaFile: string;
  current: number;
  /** Steps from each older version to the next; empty while only version 1 exists. */
  migrations: Migrations;
  schema: Schema;
  /** Checks the schema cannot express; run only on a document that passed `schema`. */
  extraChecks?: (document: JsonObject, sink: Sink) => void;
}

const HINTS: Record<SchemaIssueCode, string> = {
  SCHEMA_INVALID_JSON:
    'Fix the JSON syntax, or delete the file and let the package write it again.',
  SCHEMA_VERSION_MISSING:
    'Add the "schemaVersion" of the format at the top level, or let the package write the file again.',
  SCHEMA_VERSION_TOO_NEW:
    'The file was written by a newer version of the package; update the package to read it.',
  SCHEMA_VERSION_MISMATCH:
    'The attachment was written by another version of the package; use one package version in a run.',
  SCHEMA_VALIDATION_FAILED:
    "Fix the listed fields; the JSON Schemas in the package's schemas/ directory describe the format.",
  THRESHOLDS_KIND_MISMATCH:
    'Each kind has its own file (pw-perf-thresholds[.steps]…); move the entries to the right file or fix "kind".',
};

function describeProblems(problems: Pick<Problem, 'pointer' | 'message'>[], more: boolean): string {
  const list = problems
    .map((p) => `${p.pointer === '' ? '(root)' : p.pointer} ${p.message}`)
    .join('; ');
  return more ? `${list}; …` : list;
}

function issueOf(
  code: SchemaIssueCode,
  source: string,
  summary: string,
  problems: Pick<Problem, 'pointer' | 'message'>[] = [],
): SchemaIssue {
  const shown = problems
    .slice(0, MAX_PROBLEMS)
    .map(({ pointer, message }) => ({ pointer, message }));
  const details =
    shown.length === 0 ? '' : `: ${describeProblems(shown, problems.length > shown.length)}`;
  return { code, source, message: `${source}: ${summary}${details}`, problems: shown };
}

function failure<T>(issue: SchemaIssue): Result<T, SchemaIssue> {
  return { ok: false, issues: [issue] };
}

function parseJson(
  text: string,
  source: string,
  format: VersionedFormat,
): Result<unknown, SchemaIssue> {
  // A UTF-8 BOM is not allowed in package files (02-REQ-04), but files edited by hand may have
  // one; JSON.parse rejects it, so it is reported as invalid JSON like any other syntax error.
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return failure(
      issueOf('SCHEMA_INVALID_JSON', source, `${format.name} is not valid JSON (${reason})`),
    );
  }
}

/** Runs the migration steps from `from` up to `to` (02-REQ-10). A missing step is a bug. */
export function migrate(
  document: JsonObject,
  from: number,
  to: number,
  migrations: Migrations,
): JsonObject {
  let current = document;
  for (let version = from; version < to; version++) {
    const step = migrations[version];
    if (step === undefined) throw new Error(`no migration from schemaVersion ${version}`);
    current = { ...step(current), schemaVersion: version + 1 };
  }
  return current;
}

function validate(
  document: JsonObject,
  source: string,
  format: VersionedFormat,
): SchemaIssue | null {
  // One more than shown, so the message can tell that problems were left out.
  const sink = new Sink(MAX_PROBLEMS + 1);
  format.schema.check(document, '', sink);
  if (sink.problems.length === 0) format.extraChecks?.(document, sink);
  if (sink.problems.length === 0) return null;
  return issueOf(
    'SCHEMA_VALIDATION_FAILED',
    source,
    `${format.name} does not match the format`,
    sink.problems,
  );
}

export interface ParsedDocument {
  document: JsonObject;
  /** Original schemaVersion when the document was migrated, otherwise null. */
  migratedFrom: number | null;
}

/**
 * Generic reading of a versioned format (02-REQ-10): parse, check schemaVersion, migrate older
 * versions step by step, validate the current version. With `exactVersion` there is no
 * migration and any other version is SCHEMA_VERSION_MISMATCH (02-REQ-13).
 */
export function parseVersioned(
  text: string,
  source: string,
  format: VersionedFormat,
  options: { exactVersion?: boolean } = {},
): Result<ParsedDocument, SchemaIssue> {
  const parsed = parseJson(text, source, format);
  if (!parsed.ok) return parsed;
  const document = parsed.value;
  if (!isRecord(document)) {
    return failure(
      issueOf('SCHEMA_VALIDATION_FAILED', source, `${format.name} does not match the format`, [
        { pointer: '', message: 'must be object' },
      ]),
    );
  }

  const version = document.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    const found = Object.hasOwn(document, 'schemaVersion')
      ? `schemaVersion must be an integer, found ${JSON.stringify(version)}`
      : 'schemaVersion is missing';
    return failure(issueOf('SCHEMA_VERSION_MISSING', source, `${format.name}: ${found}`));
  }
  if (options.exactVersion === true && version !== format.current) {
    return failure(
      issueOf(
        'SCHEMA_VERSION_MISMATCH',
        source,
        `${format.name} has schemaVersion ${version}, but this package version reads only ${format.current}`,
      ),
    );
  }
  if (version > format.current) {
    return failure(
      issueOf(
        'SCHEMA_VERSION_TOO_NEW',
        source,
        `${format.name} has schemaVersion ${version}, newer than ${format.current} supported by this package version`,
      ),
    );
  }
  if (version < 1) {
    // Versions start at 1 (02-REQ-03); there is nothing to migrate from.
    return failure(
      issueOf('SCHEMA_VALIDATION_FAILED', source, `${format.name} does not match the format`, [
        { pointer: '/schemaVersion', message: 'must be >= 1' },
      ]),
    );
  }

  const current =
    version < format.current
      ? migrate(document, version, format.current, format.migrations)
      : document;
  const invalid = validate(current, source, format);
  if (invalid !== null) return failure(invalid);
  return {
    ok: true,
    value: { document: current, migratedFrom: version < format.current ? version : null },
  };
}

// ---- formats ----------------------------------------------------------------------------------

/** Calendar check of `until` (02-REQ-29); the schema checks only the YYYY-MM-DD format. */
export function isCalendarDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
  return day <= days;
}

export const SAMPLES_FORMAT: VersionedFormat = {
  name: 'sample batch',
  schemaFile: 'samples.schema.json',
  current: SCHEMA_VERSIONS.samples,
  migrations: {},
  schema: sampleBatch,
};

/**
 * Run report v1 → v2 (02-REQ-31, 02-D-16): a pure format change that computes nothing. Every
 * aggregate gets `histogram: null` and `hints: []`, every check `usage: null`, every non-null
 * `ttfb` `otherP50: null`, and the report `testBreakdown: null`.
 */
export function migrateRunReportV1(document: JsonObject): JsonObject {
  const aggregates = (value: unknown): unknown => {
    if (!isRecord(value)) return value;
    return Object.fromEntries(
      Object.entries(value).map(([name, aggregate]) => {
        if (!isRecord(aggregate)) return [name, aggregate];
        const evaluation = aggregate.evaluation;
        const ttfb = aggregate.ttfb;
        return [
          name,
          {
            ...aggregate,
            ttfb: isRecord(ttfb) ? { ...ttfb, otherP50: null } : ttfb,
            evaluation:
              isRecord(evaluation) && Array.isArray(evaluation.checks)
                ? {
                    ...evaluation,
                    checks: evaluation.checks.map((check: unknown) =>
                      isRecord(check) ? { ...check, usage: null } : check,
                    ),
                  }
                : evaluation,
            histogram: null,
            hints: [],
          },
        ];
      }),
    );
  };
  return {
    ...document,
    endpoints: aggregates(document.endpoints),
    custom: aggregates(document.custom),
    testBreakdown: null,
  };
}

/** Config snapshot without the custom limits and T (02-REQ-33); other values unchanged. */
function withoutCustomOptions(config: unknown): unknown {
  if (!isRecord(config) || !isRecord(config.checks)) return config;
  const drop = (value: unknown): unknown => {
    if (!isRecord(value)) return value;
    const { custom: _removed, ...rest } = value;
    return rest;
  };
  const checks = Object.fromEntries(
    Object.entries(config.checks).map(([group, rules]) => {
      if (!isRecord(rules)) return [group, rules];
      // checks.errors is a rule itself; the other groups hold rules.
      if (group === 'errors') return [group, { ...rules, limit: drop(rules.limit) }];
      return [
        group,
        Object.fromEntries(
          Object.entries(rules).map(([name, rule]) => {
            if (group === 'slowShare' && name === 't') return [name, drop(rule)];
            if (!isRecord(rule) || !Object.hasOwn(rule, 'limit')) return [name, rule];
            return [name, { ...rule, limit: drop(rule.limit) }];
          }),
        ),
      ];
    }),
  );
  return { ...config, checks };
}

/**
 * Config snapshot with the step options of version 3 (02-REQ-33): measure.steps off and the
 * default step limits and T (06-REQ-30); options a sparse snapshot lacks stay absent.
 */
function withStepOptions(config: unknown): unknown {
  if (!isRecord(config)) return config;
  const out: JsonObject = { ...config };
  if (isRecord(config.measure) && !Object.hasOwn(config.measure, 'steps')) {
    out.measure = { ...config.measure, steps: expandSteps(false) };
  }
  if (isRecord(config.checks)) {
    const defaults = DEFAULT_CONFIG.checks as unknown as JsonObject;
    const withStep = (value: unknown, fallback: unknown): unknown =>
      isRecord(value) && !Object.hasOwn(value, 'step') && isRecord(fallback)
        ? { ...value, step: structuredClone(fallback.step) }
        : value;
    out.checks = Object.fromEntries(
      Object.entries(config.checks).map(([group, rules]) => {
        const groupDefaults = defaults[group];
        if (!isRecord(rules) || !isRecord(groupDefaults)) return [group, rules];
        if (group === 'errors') {
          return [group, { ...rules, limit: withStep(rules.limit, groupDefaults.limit) }];
        }
        return [
          group,
          Object.fromEntries(
            Object.entries(rules).map(([name, rule]) => {
              const ruleDefaults = groupDefaults[name];
              if (group === 'slowShare' && name === 't')
                return [name, withStep(rule, ruleDefaults)];
              if (!isRecord(rule) || !isRecord(ruleDefaults)) return [name, rule];
              if (!Object.hasOwn(rule, 'limit')) return [name, rule];
              return [name, { ...rule, limit: withStep(rule.limit, ruleDefaults.limit) }];
            }),
          ),
        ];
      }),
    );
  }
  return out;
}

/** config.run.repeat of a snapshot before D-39 becomes config.run.passes with the same values. */
function withPassesOption(config: unknown): unknown {
  if (!isRecord(config) || !isRecord(config.run)) return config;
  const { repeat, ...run } = config.run;
  return repeat === undefined ? config : { ...config, run: { ...run, passes: repeat } };
}

/**
 * Options of a snapshot before D-40/D-41 (02-REQ-38): gate.warnOnly is dropped without a warning,
 * thresholds.preset becomes "normal" and run.grep null (the margins are already complete).
 */
function withGateAndPresetOptions(config: unknown): unknown {
  if (!isRecord(config)) return config;
  const out: JsonObject = { ...config };
  if (isRecord(config.gate)) {
    const { warnOnly: _warnOnly, ...gate } = config.gate;
    out.gate = gate;
  }
  if (isRecord(config.thresholds) && !Object.hasOwn(config.thresholds, 'preset')) {
    out.thresholds = { preset: 'normal', ...config.thresholds };
  }
  if (isRecord(config.run) && !Object.hasOwn(config.run, 'grep')) {
    out.run = { ...config.run, grep: null };
  }
  return out;
}

/**
 * Run report v2 → v3 (02-REQ-33, 02-D-18): custom measurements were removed (D-32). Drops
 * `custom`, `evaluation.counts.custom`, thresholdFiles entries of kind custom and the custom
 * options of the config snapshot, without a warning. Warnings with CUSTOM_* codes stay as text.
 * Adds the step fields of version 3: `steps: {}`, `stepNormalization: null`, zero
 * `evaluation.counts.step` and the step options of the config snapshot; `passes` of one pass and
 * `config.run.passes` from `config.run.repeat` (D-39, 02-REQ-37); no gate.warnOnly, with
 * thresholds.preset and run.grep (02-REQ-38).
 */
export function migrateRunReportV2(document: JsonObject): JsonObject {
  const { custom: _custom, ...rest } = document;
  const evaluation = document.evaluation;
  const counts = isRecord(evaluation) ? evaluation.counts : undefined;
  const files = document.thresholdFiles;
  return {
    ...rest,
    stepNormalization: null,
    steps: {},
    // A run before D-39 ran its repetitions in one pass (02-REQ-37).
    passes: { planned: 1, completed: 1, failed: [] },
    config: withGateAndPresetOptions(
      withPassesOption(withStepOptions(withoutCustomOptions(document.config))),
    ),
    evaluation:
      isRecord(evaluation) && isRecord(counts)
        ? {
            ...evaluation,
            counts: {
              ...Object.fromEntries(Object.entries(counts).filter(([k]) => k !== 'custom')),
              step: Object.fromEntries(Object.keys(counts.api ?? {}).map((name) => [name, 0])),
            },
          }
        : evaluation,
    thresholdFiles: Array.isArray(files)
      ? files.filter((file: unknown) => !(isRecord(file) && file.kind === 'custom'))
      : files,
  };
}

/** Sum of the numbers of an array; NaN when an item is not a number. */
function sum(values: unknown[]): number {
  return values.reduce<number>((total, v) => total + (typeof v === 'number' ? v : Number.NaN), 0);
}

/**
 * Checks of the run report v2 that the JSON Schema cannot express (02-REQ-30, 02-AC-17):
 * histogram edges strictly ascending, counts of length edges.length − 1 that sum to the number of
 * retained durations; violatedKeys of length min(10, violatedKeyCount); waterfall requests plus
 * omitted equal to requestCount. Runs only on a document that passed the schema.
 */
export function checkRunReport(document: JsonObject, sink: Sink): void {
  for (const kind of ['endpoints']) {
    const map = document[kind] as Record<string, Record<string, unknown>>;
    for (const [name, aggregate] of Object.entries(map)) {
      const histogram = aggregate.histogram as { edges: number[]; counts: number[] } | null;
      if (histogram === null) continue;
      const pointer = child(child(`/${kind}`, name), 'histogram');
      const { edges, counts } = histogram;
      if (edges.some((edge, i) => i > 0 && edge <= (edges[i - 1] ?? 0))) {
        sink.add(child(pointer, 'edges'), 'must be strictly ascending');
      }
      if (counts.length !== edges.length - 1) {
        sink.add(child(pointer, 'counts'), 'must have one item fewer than edges');
      }
      const retained = (aggregate.samples as { durations: unknown[] }).durations.length;
      if (sum(counts) !== retained) {
        sink.add(child(pointer, 'counts'), 'must sum to the number of samples.durations');
      }
    }
  }
  const breakdown = document.testBreakdown as {
    tests: { violatedKeys: unknown[]; violatedKeyCount: number }[];
    waterfalls: { requests: unknown[]; omitted: number; requestCount: number }[];
  } | null;
  if (breakdown === null) return;
  breakdown.tests.forEach((test, i) => {
    if (test.violatedKeys.length !== Math.min(10, test.violatedKeyCount)) {
      sink.add(
        `/testBreakdown/tests/${i}/violatedKeys`,
        'must have min(10, violatedKeyCount) items',
      );
    }
  });
  breakdown.waterfalls.forEach((waterfall, i) => {
    if (waterfall.requests.length + waterfall.omitted !== waterfall.requestCount) {
      sink.add(`/testBreakdown/waterfalls/${i}`, 'requests plus omitted must equal requestCount');
    }
  });
}

/**
 * Run report v3 → v4 (02-REQ-39, 02-REQ-41, D-44, D-45, D-46, D-49): run.projects was removed, so
 * the config snapshot loses it, and run.overrideSlowMo, measure.api and report.junit were added
 * with false, true and false (old runs wrote no junit.xml), all without a warning; everything else
 * stays.
 */
export function migrateRunReportV3(document: JsonObject): JsonObject {
  const config = document.config;
  if (!isRecord(config) || !isRecord(config.run)) return document;
  const { projects: _projects, ...run } = config.run;
  const measure = isRecord(config.measure) ? { api: true, ...config.measure } : config.measure;
  const report = isRecord(config.report) ? { ...config.report, junit: false } : config.report;
  return {
    ...document,
    config: { ...config, run: { ...run, overrideSlowMo: false }, measure, report },
  };
}

/** Aggregate fields of 1.1.0 for an aggregate of a v4 report (02-REQ-43). */
function withV5AggregateFields(
  aggregate: unknown,
  isSuccess: ((label: string) => boolean) | null,
): unknown {
  if (!isRecord(aggregate)) return aggregate;
  let nonSuccessCount: number | null = null;
  if (isSuccess !== null && isRecord(aggregate.statuses)) {
    nonSuccessCount = 0;
    for (const [label, n] of Object.entries(aggregate.statuses)) {
      if (/^[1-5][0-9]{2}$/u.test(label) && !isSuccess(label) && typeof n === 'number') {
        nonSuccessCount += n;
      }
    }
  }
  const evaluation = aggregate.evaluation;
  return {
    ...aggregate,
    cold: null,
    nonSuccessCount,
    failedTimings: [],
    evaluation: isRecord(evaluation)
      ? {
          ...evaluation,
          limits: isRecord(evaluation.limits)
            ? { ...evaluation.limits, maxNonSuccessRate: null }
            : evaluation.limits,
          workload: null,
        }
      : evaluation,
  };
}

function mapValues(map: unknown, f: (value: unknown) => unknown): unknown {
  if (!isRecord(map)) return map;
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, f(v)]));
}

/**
 * Run report v4 → v5 (02-REQ-43, 02-AC-24): aggregates get cold null, nonSuccessCount from the
 * statuses outside the snapshot's measure.successStatuses (null for steps), failedTimings [],
 * evaluation.workload null and limits.maxNonSuccessRate null; the config snapshot gets the new
 * options with coldSamples 0 (an old run did not set cold samples apart), the nonSuccess rule
 * with the margin of the errors rule (presets set both alike, 03-REQ-30), the default
 * workloadShift and keys.operations [] (an old run had no operation keys).
 */
export function migrateRunReportV4(document: JsonObject): JsonObject {
  const config = document.config;
  const measure = isRecord(config) ? config.measure : undefined;
  const statuses = isRecord(measure) ? measure.successStatuses : undefined;
  const isSuccess = compileStatusMatcher(
    Array.isArray(statuses)
      ? statuses.filter((s): s is string => typeof s === 'string')
      : DEFAULT_CONFIG.measure.successStatuses,
  );
  let snapshot = config;
  if (isRecord(config)) {
    const checks = isRecord(config.checks) ? config.checks : {};
    const errors = isRecord(checks.errors) ? checks.errors : {};
    const defaults = DEFAULT_CONFIG.checks.nonSuccess;
    const thresholds = isRecord(config.thresholds) ? config.thresholds : {};
    const keys = isRecord(config.keys) ? config.keys : {};
    snapshot = {
      ...config,
      // Also in a sparse snapshot: the default (1) would claim cold samples were set apart.
      measure: { ...(isRecord(measure) ? measure : {}), coldSamples: 0 },
      checks: {
        ...checks,
        nonSuccess: {
          ...defaults,
          limit: { ...defaults.limit },
          margin: isRecord(errors.margin) ? { ...errors.margin } : { ...defaults.margin },
        },
      },
      thresholds: {
        ...thresholds,
        workloadShift: { ...DEFAULT_CONFIG.thresholds.workloadShift },
      },
      keys: { ...keys, operations: [] },
    };
  }
  return {
    ...document,
    config: snapshot,
    endpoints: mapValues(document.endpoints, (a) => withV5AggregateFields(a, isSuccess)),
    steps: mapValues(document.steps, (a) => withV5AggregateFields(a, null)),
  };
}

export const RUN_REPORT_FORMAT: VersionedFormat = {
  name: 'run report',
  schemaFile: 'run-report.schema.json',
  current: SCHEMA_VERSIONS.runReport,
  migrations: {
    1: migrateRunReportV1,
    2: migrateRunReportV2,
    3: migrateRunReportV3,
    4: migrateRunReportV4,
  },
  schema: runReport,
  extraChecks: checkRunReport,
};

export const THRESHOLDS_FORMAT: VersionedFormat = {
  name: 'thresholds file',
  schemaFile: 'thresholds.schema.json',
  current: SCHEMA_VERSIONS.thresholds,
  // v1 → v2 changes no content (02-REQ-33): a v1 file of kind custom fails validation after it.
  // v2 → v3 changes no content either: the fields of 1.1.0 are optional (02-REQ-43).
  migrations: { 1: (document) => document, 2: (document) => document },
  schema: thresholdsFile,
  extraChecks(document, sink) {
    const entries = document.entries as Record<string, Record<string, unknown>>;
    for (const [name, entry] of Object.entries(entries)) {
      if (typeof entry.until === 'string' && !isCalendarDate(entry.until)) {
        sink.add(child(child('/entries', name), 'until'), 'must be an existing calendar date');
      }
    }
  },
};

export const OUTCOME_FORMAT: VersionedFormat = {
  name: 'outcome file',
  schemaFile: 'outcome.schema.json',
  current: SCHEMA_VERSIONS.outcome,
  migrations: {},
  schema: outcomeFile,
};

/** 02-REQ-13: no migration; any other schemaVersion gives SCHEMA_VERSION_MISMATCH. */
export function parseSampleBatch(text: string, source: string): Result<SampleBatch, SchemaIssue> {
  const parsed = parseVersioned(text, source, SAMPLES_FORMAT, { exactVersion: true });
  return parsed.ok ? { ok: true, value: parsed.value.document as unknown as SampleBatch } : parsed;
}

/** 02-REQ-10: migrates older versions, then validates. */
export function parseRunReport(text: string, source: string): Result<RunReport, SchemaIssue> {
  const parsed = parseVersioned(text, source, RUN_REPORT_FORMAT);
  return parsed.ok ? { ok: true, value: parsed.value.document as unknown as RunReport } : parsed;
}

/**
 * 02-REQ-10, 02-REQ-12, 02-REQ-22, 02-REQ-29. migratedFrom: original schemaVersion when the
 * file was migrated (the caller warns THRESHOLDS_FILE_OUTDATED).
 */
export function parseThresholdsFile(
  text: string,
  source: string,
  expectedKind: Kind,
): Result<{ file: ThresholdsFile; migratedFrom: number | null }, SchemaIssue> {
  const parsed = parseVersioned(text, source, THRESHOLDS_FORMAT);
  if (!parsed.ok) return parsed;
  const file = parsed.value.document as unknown as ThresholdsFile;
  if (file.kind !== expectedKind) {
    return failure(
      issueOf(
        'THRESHOLDS_KIND_MISMATCH',
        source,
        `thresholds file has kind "${file.kind}", but this path holds "${expectedKind}" thresholds`,
        [{ pointer: '/kind', message: `must be "${expectedKind}"` }],
      ),
    );
  }
  return { ok: true, value: { file, migratedFrom: parsed.value.migratedFrom } };
}

/** Reader side of 02-REQ-26 (tests and CI tooling). */
export function parseOutcome(text: string, source: string): Result<OutcomeFile, SchemaIssue> {
  const parsed = parseVersioned(text, source, OUTCOME_FORMAT);
  return parsed.ok ? { ok: true, value: parsed.value.document as unknown as OutcomeFile } : parsed;
}

/**
 * Issue for warnings or toolErrors in the run report (P-12): the message names the source and
 * the problems, the hint says what to do.
 */
export function schemaIssueToIssue(issue: SchemaIssue): Issue {
  return { code: issue.code, message: issue.message, hint: HINTS[issue.code] };
}
