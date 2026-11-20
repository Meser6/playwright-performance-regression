// Reading the file formats: JSON parsing, schemaVersion handling and migrations, validation
// (02, chapters 5 and 9.1). Errors are values (01-REQ-04).
import type {
  Issue,
  OutcomeFile,
  Result,
  RunReport,
  SampleBatch,
  ThresholdsFile,
} from '../types/index.ts';
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

/** Current schemaVersion of every format. All formats are at 1 until the first release. */
export const SCHEMA_VERSIONS = {
  samples: 1,
  runReport: 1,
  thresholds: 1,
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
    'Each kind has its own file (pw-perf-thresholds.api… and pw-perf-thresholds.custom…); move the entries to the right file or fix "kind".',
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

export const RUN_REPORT_FORMAT: VersionedFormat = {
  name: 'run report',
  schemaFile: 'run-report.schema.json',
  current: SCHEMA_VERSIONS.runReport,
  migrations: {},
  schema: runReport,
};

export const THRESHOLDS_FORMAT: VersionedFormat = {
  name: 'thresholds file',
  schemaFile: 'thresholds.schema.json',
  current: SCHEMA_VERSIONS.thresholds,
  migrations: {},
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
  expectedKind: 'api' | 'custom',
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

/** CLI side of 02-REQ-26. */
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
