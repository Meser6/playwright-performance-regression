import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  isCalendarDate,
  parseOutcome,
  parseRunReport,
  parseSampleBatch,
  parseThresholdsFile,
  SCHEMA_VERSIONS,
  schemaIssueToIssue,
} from '../../../src/core/schema/index.ts';
import { constant, int, obj, str } from '../../../src/core/schema/dsl.ts';
import { migrate, parseVersioned } from '../../../src/core/schema/parse.ts';
import type { VersionedFormat } from '../../../src/core/schema/parse.ts';
import { GOLDEN_DIR, loadCases, oldVersionDirs } from '../../contract/golden.ts';
import type { Format } from '../../contract/golden.ts';

const validInput = (format: Format, file: string): Record<string, unknown> => {
  const found = loadCases(format).find((c) => c.dir === 'valid' && c.file === file);
  if (found === undefined) throw new Error(`no golden case ${format}/${file}`);
  return structuredClone(found.input) as Record<string, unknown>;
};
const text = (value: unknown): string => JSON.stringify(value);

const thresholds = validInput('thresholds', 'generated-api-file.json');
const batch = validInput('samples', 'batch-with-ok-failed-and-pending.json');
const report = validInput('run-report', 'empty-run.json');
const outcome = validInput('outcome', 'test-mode-passed.json');

/** A format at version 3 with migrations 1→2 (rename) and 2→3 (new required field). */
const fakeFormat: VersionedFormat = {
  name: 'fake file',
  schemaFile: 'fake.schema.json',
  current: 3,
  migrations: {
    1: ({ oldName, ...rest }) => ({ ...rest, name: oldName }),
    2: (doc) => ({ ...doc, size: 0 }),
  },
  schema: obj(
    { schemaVersion: constant(3), name: str({ minLength: 1 }), size: int({ minimum: 0 }) },
    { required: ['schemaVersion', 'name', 'size'] },
  ),
};

describe('schemaVersion handling (02-REQ-10)', () => {
  test('all formats are at version 1 until the first release (02-REQ-13)', () => {
    expect(SCHEMA_VERSIONS).toEqual({ samples: 1, runReport: 1, thresholds: 1, outcome: 1 });
  });

  test('02-AC-03 a newer schemaVersion gives SCHEMA_VERSION_TOO_NEW for every migrating format', () => {
    const results = [
      parseRunReport(text({ ...report, schemaVersion: 2 }), 'report.json'),
      parseThresholdsFile(text({ ...thresholds, schemaVersion: 2 }), 't.json', 'api'),
      parseOutcome(text({ ...outcome, schemaVersion: 2 }), 'outcome.json'),
    ];
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues[0]?.code).toBe('SCHEMA_VERSION_TOO_NEW');
    }
  });

  test('02-AC-03 older versions are migrated step by step, then validated', () => {
    const result = parseVersioned(text({ schemaVersion: 1, oldName: 'a' }), 'f.json', fakeFormat);
    expect(result).toEqual({
      ok: true,
      value: { document: { schemaVersion: 3, name: 'a', size: 0 }, migratedFrom: 1 },
    });
    const fromTwo = parseVersioned(text({ schemaVersion: 2, name: 'b' }), 'f.json', fakeFormat);
    expect(fromTwo).toEqual({
      ok: true,
      value: { document: { schemaVersion: 3, name: 'b', size: 0 }, migratedFrom: 2 },
    });
    const current = parseVersioned(text({ schemaVersion: 3, name: 'c', size: 1 }), 'f', fakeFormat);
    expect(current.ok && current.value.migratedFrom).toBe(null);
  });

  test('02-AC-03 a migrated document that is still invalid fails validation', () => {
    const result = parseVersioned(text({ schemaVersion: 1, oldName: '' }), 'f.json', fakeFormat);
    expect(!result.ok && result.issues[0]).toMatchObject({
      code: 'SCHEMA_VALIDATION_FAILED',
      problems: [{ pointer: '/name' }],
    });
  });

  test('02-AC-03 every older version kept in test/golden migrates to a valid current file', () => {
    // Formats are at version 1, so there are no v<N> directories yet (02-REQ-11 applies from
    // the first release); the loop picks them up as they are added.
    const parsers = {
      'run-report': (t: string) => parseRunReport(t, 'golden'),
      thresholds: (t: string) => parseThresholdsFile(t, 'golden', 'api'),
      outcome: (t: string) => parseOutcome(t, 'golden'),
    };
    for (const [format, parse] of Object.entries(parsers)) {
      for (const dir of oldVersionDirs(format as Format)) {
        const base = join(GOLDEN_DIR, format, dir);
        for (const file of readdirSync(base)) {
          const result = parse(readFileSync(join(base, file), 'utf8'));
          expect(result.ok, `${format}/${dir}/${file}`).toBe(true);
        }
      }
    }
  });

  test('a missing migration step is a programming error', () => {
    expect(() => migrate({ schemaVersion: 1 }, 1, 3, { 1: (d) => d })).toThrow(
      /from schemaVersion 2/,
    );
  });

  test('missing or non-integer schemaVersion gives SCHEMA_VERSION_MISSING', () => {
    for (const version of [undefined, '1', 1.5, null, true]) {
      const doc =
        version === undefined
          ? { ...outcome, schemaVersion: undefined }
          : { ...outcome, schemaVersion: version };
      const result = parseOutcome(text(doc), 'outcome.json');
      expect(!result.ok && result.issues[0]?.code, String(version)).toBe('SCHEMA_VERSION_MISSING');
    }
  });

  test('schemaVersion below 1 is a validation error, not a migration', () => {
    const result = parseRunReport(text({ ...report, schemaVersion: 0 }), 'report.json');
    expect(!result.ok && result.issues[0]).toMatchObject({
      code: 'SCHEMA_VALIDATION_FAILED',
      problems: [{ pointer: '/schemaVersion', message: 'must be >= 1' }],
    });
  });
});

describe('sample batch (02-REQ-13)', () => {
  test('02-AC-13 schemaVersion 0 or 2 gives SCHEMA_VERSION_MISMATCH and a tool error entry', () => {
    for (const version of [0, 2]) {
      const result = parseSampleBatch(text({ ...batch, schemaVersion: version }), 'tickets › open');
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      const [issue] = result.issues;
      if (issue === undefined) throw new Error('no issue');
      expect(issue.code).toBe('SCHEMA_VERSION_MISMATCH');
      expect(issue.source).toBe('tickets › open');
      // The reporter skips the attachment and records this entry in toolErrors.
      const toolError = schemaIssueToIssue(issue);
      expect(toolError).toEqual({
        code: 'SCHEMA_VERSION_MISMATCH',
        message: `tickets › open: sample batch has schemaVersion ${version}, but this package version reads only 1`,
        hint: expect.stringContaining('one package version'),
      });
    }
  });

  test('the current version is accepted without migration', () => {
    const result = parseSampleBatch(text(batch), 'tickets › open');
    expect(result).toEqual({ ok: true, value: batch });
  });
});

describe('thresholds file (02-REQ-22, 02-REQ-29)', () => {
  const muted = (until: string) => ({
    ...thresholds,
    entries: { 'GET /api/tickets': { gate: 'warn', note: 'Known slow', until } },
  });

  test('02-AC-12 parseThresholdsFile accepts an entry with only muting', () => {
    const result = parseThresholdsFile(text(muted('2026-12-31')), 't.json', 'api');
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.migratedFrom).toBe(null);
  });

  test('02-AC-12 parseThresholdsFile rejects a date that does not exist (2026-02-30)', () => {
    const result = parseThresholdsFile(
      text(muted('2026-02-30')),
      'perf-thresholds.api.json',
      'api',
    );
    expect(!result.ok && result.issues[0]).toEqual({
      code: 'SCHEMA_VALIDATION_FAILED',
      source: 'perf-thresholds.api.json',
      message:
        'perf-thresholds.api.json: thresholds file does not match the format: /entries/GET ~1api~1tickets/until must be an existing calendar date',
      problems: [
        {
          pointer: '/entries/GET ~1api~1tickets/until',
          message: 'must be an existing calendar date',
        },
      ],
    });
  });

  test('02-AC-12 parseThresholdsFile rejects muting without gate, note or until and a bad gate', () => {
    for (const entry of [
      { note: 'n', percentile: 900, until: '2026-12-31' },
      { gate: 'warn', until: '2026-12-31' },
      { gate: 'warn', note: 'n' },
      { gate: 'off', note: 'n', until: '2026-12-31' },
      { gate: 'warn', note: 'n', until: '2026-13-01' },
    ]) {
      const doc = { ...thresholds, entries: { 'GET /a': entry } };
      const result = parseThresholdsFile(text(doc), 't.json', 'api');
      expect(!result.ok && result.issues[0]?.code, JSON.stringify(entry)).toBe(
        'SCHEMA_VALIDATION_FAILED',
      );
    }
  });

  test('isCalendarDate knows month lengths and leap years', () => {
    for (const date of ['2026-01-31', '2026-04-30', '2028-02-29', '2000-02-29', '2026-12-31']) {
      expect(isCalendarDate(date), date).toBe(true);
    }
    for (const date of [
      '2026-02-29',
      '1900-02-29',
      '2026-04-31',
      '2026-00-10',
      '2026-01-00',
      '2026-1-1',
    ]) {
      expect(isCalendarDate(date), date).toBe(false);
    }
  });

  test('kind of the file must match the path (02-REQ-22)', () => {
    const result = parseThresholdsFile(text(thresholds), 'perf-thresholds.custom.json', 'custom');
    expect(!result.ok && result.issues[0]).toMatchObject({
      code: 'THRESHOLDS_KIND_MISMATCH',
      problems: [{ pointer: '/kind', message: 'must be "custom"' }],
    });
  });
});

describe('issue messages (02, chapter 10)', () => {
  test('lists at most 5 problems with JSON pointers and the source', () => {
    const doc = {
      ...outcome,
      runId: '',
      mode: 'x',
      exitCode: 1,
      tests: {},
      toolErrors: 1,
      paths: {},
    };
    const result = parseOutcome(text(doc), '/tmp/outcome.json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const [issue] = result.issues;
    expect(issue?.problems).toHaveLength(5);
    expect(issue?.message).toMatch(
      /^\/tmp\/outcome\.json: outcome file does not match the format: /,
    );
    expect(issue?.message).toContain('/exitCode must be one of 0, 2, 3; /mode must be one of');
    expect(issue?.message.endsWith('; …')).toBe(true);
  });

  test('invalid JSON names the source and the parser error', () => {
    const result = parseRunReport('{', 'perf-results/report.json');
    expect(!result.ok && result.issues[0]).toMatchObject({
      code: 'SCHEMA_INVALID_JSON',
      source: 'perf-results/report.json',
      problems: [],
    });
    expect(!result.ok && result.issues[0]?.message).toMatch(
      /^perf-results\/report\.json: run report is not valid JSON \(/,
    );
  });

  test('every code has a hint', () => {
    for (const code of [
      'SCHEMA_INVALID_JSON',
      'SCHEMA_VERSION_MISSING',
      'SCHEMA_VERSION_TOO_NEW',
      'SCHEMA_VERSION_MISMATCH',
      'SCHEMA_VALIDATION_FAILED',
      'THRESHOLDS_KIND_MISMATCH',
    ] as const) {
      const issue = schemaIssueToIssue({ code, source: 's', message: 'm', problems: [] });
      expect(issue.hint?.length, code).toBeGreaterThan(10);
    }
  });

  test('a oneOf failure is explained by the alternative of the right type', () => {
    const result = parseSampleBatch(
      text({ ...batch, requests: [{ ...(batch.requests as object[])[0], duration: -1 }] }),
      's',
    );
    expect(!result.ok && result.issues[0]?.problems).toEqual([
      { pointer: '/requests/0/duration', message: 'must be >= 0' },
    ]);
    const other = parseSampleBatch(
      text({ ...batch, requests: [{ ...(batch.requests as object[])[0], status: 'OK' }] }),
      's',
    );
    expect(!other.ok && other.issues[0]?.problems).toEqual([
      { pointer: '/requests/0/status', message: 'must be integer or "FAILED" or "PENDING"' },
    ]);
  });
});
