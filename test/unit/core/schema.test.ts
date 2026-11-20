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
import { migrate, parseVersioned, RUN_REPORT_FORMAT } from '../../../src/core/schema/parse.ts';
import type { VersionedFormat } from '../../../src/core/schema/parse.ts';
import { GOLDEN_DIR, loadCases, oldVersionDirs } from '../../contract/golden.ts';
import type { Format } from '../../contract/golden.ts';
import { createAjv, validator } from '../../contract/schemas.ts';

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
  test('sample batch v2, run report v3, thresholds file v2, outcome file v1 (02-REQ-11, 02-REQ-33)', () => {
    expect(SCHEMA_VERSIONS).toEqual({ samples: 2, runReport: 3, thresholds: 2, outcome: 1 });
  });

  test('02-AC-03 a newer schemaVersion gives SCHEMA_VERSION_TOO_NEW for every migrating format', () => {
    const results = [
      parseRunReport(text({ ...report, schemaVersion: 4 }), 'report.json'),
      parseThresholdsFile(text({ ...thresholds, schemaVersion: 3 }), 't.json', 'api'),
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
    // test/golden/<format>/v<N>/ holds documents of older versions (02-REQ-11); the loop picks
    // up the directories of every format as they are added. A file named after an error code
    // must fail with that code after the migration (02-AC-18: thresholds of kind custom).
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
          const code = /^([A-Z_]+)-/u.exec(file)?.[1];
          if (code === undefined) expect(result.ok, `${format}/${dir}/${file}`).toBe(true);
          else expect(!result.ok && result.issues[0]?.code, `${format}/${dir}/${file}`).toBe(code);
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
  test('02-AC-13 schemaVersion 0 or 1 gives SCHEMA_VERSION_MISMATCH and a tool error entry', () => {
    for (const version of [0, 1]) {
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
        message: `tickets › open: sample batch has schemaVersion ${version}, but this package version reads only 2`,
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
      'pw-perf-thresholds.api.json',
      'api',
    );
    expect(!result.ok && result.issues[0]).toEqual({
      code: 'SCHEMA_VALIDATION_FAILED',
      source: 'pw-perf-thresholds.api.json',
      message:
        'pw-perf-thresholds.api.json: thresholds file does not match the format: /entries/GET ~1api~1tickets/until must be an existing calendar date',
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
    // Only kind api exists until step timings (WP-20); the check itself does not depend on it.
    const result = parseThresholdsFile(
      text(thresholds),
      'pw-perf-thresholds.other.json',
      'other' as 'api',
    );
    expect(!result.ok && result.issues[0]).toMatchObject({
      code: 'THRESHOLDS_KIND_MISMATCH',
      problems: [{ pointer: '/kind', message: 'must be "other"' }],
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
    const result = parseRunReport('{', 'pw-perf-results/report.json');
    expect(!result.ok && result.issues[0]).toMatchObject({
      code: 'SCHEMA_INVALID_JSON',
      source: 'pw-perf-results/report.json',
      problems: [],
    });
    expect(!result.ok && result.issues[0]?.message).toMatch(
      /^pw-perf-results\/report\.json: run report is not valid JSON \(/,
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

type Json = Record<string, unknown>;
type Aggregate = Json & { evaluation: Json & { checks: Json[] }; ttfb: Json | null };

describe('run report version 2 (02-REQ-30, 02-REQ-31)', () => {
  const v1Text = readFileSync(join(GOLDEN_DIR, 'run-report', 'v1', 'full-run.json'), 'utf8');
  const v1 = JSON.parse(v1Text) as Json;

  test('02-AC-16 the v1 golden report migrates to v2 with nulls and empty lists, other fields unchanged', () => {
    expect(v1['schemaVersion']).toBe(1);
    // The v2 validator is gone since version 3 (02-REQ-33); the step 1 → 2 is checked here and
    // the whole chain 1 → 2 → 3, with validation, by 02-AC-18.
    expect(parseRunReport(v1Text, 'v1.json').ok).toBe(true);
    const migrated = migrate(v1, 1, 2, RUN_REPORT_FORMAT.migrations) as Json;
    expect(migrated['schemaVersion']).toBe(2);
    expect(migrated['testBreakdown']).toBeNull();
    const aggregates = ['endpoints', 'custom'].flatMap((kind) =>
      Object.values(migrated[kind] as Record<string, Aggregate>),
    );
    expect(aggregates.length).toBeGreaterThan(2);
    for (const aggregate of aggregates) {
      expect(aggregate['histogram']).toBeNull();
      expect(aggregate['hints']).toEqual([]);
      for (const check of aggregate.evaluation.checks) expect(check['usage']).toBeNull();
      if (aggregate.ttfb !== null) expect(aggregate.ttfb['otherP50']).toBeNull();
    }
    expect(aggregates.some((a) => a.ttfb !== null)).toBe(true);
    expect(aggregates.some((a) => a.evaluation.checks.length > 0)).toBe(true);

    // Removing the new fields gives the input back.
    const back = structuredClone(migrated);
    delete back['testBreakdown'];
    back['schemaVersion'] = 1;
    for (const kind of ['endpoints', 'custom']) {
      for (const aggregate of Object.values(back[kind] as Record<string, Aggregate>)) {
        delete aggregate['histogram'];
        delete aggregate['hints'];
        for (const check of aggregate.evaluation.checks) delete check['usage'];
        if (aggregate.ttfb !== null) delete aggregate.ttfb['otherP50'];
      }
    }
    expect(back).toEqual(v1);
  });

  const ajv = createAjv();
  const schemaAccepts = validator(ajv, 'run-report.schema.json');
  const golden = validInput('run-report', 'full-run.json');
  const KEY = 'GET /api/tickets/:id';

  /** The full-run golden with one change; returns [Ajv verdict, parser verdict]. */
  function verdicts(change: (doc: Json & { endpoints: Record<string, Aggregate> }) => void) {
    const doc = structuredClone(golden) as Json & { endpoints: Record<string, Aggregate> };
    change(doc);
    return [schemaAccepts(doc), parseRunReport(text(doc), 'r.json').ok];
  }
  const breakdown = (doc: Json) =>
    doc['testBreakdown'] as {
      tests: Json[];
      waterfalls: (Json & { requests: Json[] })[];
    };

  test('02-AC-17 the schema accepts the golden report with every field added in v2', () => {
    const tickets = golden['endpoints'] as Record<string, Aggregate>;
    expect(tickets[KEY]?.['histogram']).not.toBeNull();
    expect(breakdown(golden).tests.length).toBeGreaterThan(0);
    expect(breakdown(golden).waterfalls.length).toBeGreaterThan(0);
    expect(verdicts(() => undefined)).toEqual([true, true]);
  });

  test('02-AC-17 the schema rejects 31 bins, 501 tests, 6 waterfalls, 201 requests, 4 hints and unknown hints', () => {
    const cases: [string, (doc: Json & { endpoints: Record<string, Aggregate> }) => void][] = [
      [
        '31 bins',
        (d) => {
          const h = d.endpoints[KEY] as Json;
          h['histogram'] = {
            edges: Array.from({ length: 32 }, (_, i) => i + 1),
            counts: Array.from({ length: 31 }, () => 0),
          };
        },
      ],
      [
        '501 tests',
        (d) => {
          const t = breakdown(d).tests;
          breakdown(d).tests = Array.from({ length: 501 }, () => structuredClone(t[0] as Json));
        },
      ],
      [
        '6 waterfalls',
        (d) => {
          const w = breakdown(d).waterfalls;
          breakdown(d).waterfalls = Array.from({ length: 6 }, () => structuredClone(w[0] as never));
        },
      ],
      [
        '201 requests',
        (d) => {
          const w = breakdown(d).waterfalls[0] as Json & { requests: Json[] };
          w.requests = Array.from({ length: 201 }, () => structuredClone(w.requests[0] as Json));
          w['requestCount'] = 201;
          w['omitted'] = 0;
        },
      ],
      [
        '4 hints',
        (d) => {
          (d.endpoints[KEY] as Json)['hints'] = Array.from({ length: 4 }, () => ({
            code: 'HINT_MUTED',
            params: {},
          }));
        },
      ],
      [
        'unknown hint code',
        (d) => {
          (d.endpoints[KEY] as Json)['hints'] = [{ code: 'HINT_OTHER', params: {} }];
        },
      ],
      [
        'unknown params field',
        (d) => {
          (d.endpoints[KEY] as Json)['hints'] = [{ code: 'HINT_MUTED', params: { note: 'x' } }];
        },
      ],
    ];
    for (const [name, change] of cases) expect(verdicts(change), name).toEqual([false, false]);
  });

  test('02-AC-17 the parser rejects what the schema cannot express: counts length, descending edges, sums', () => {
    const cases: [string, (doc: Json & { endpoints: Record<string, Aggregate> }) => void][] = [
      [
        'counts not edges.length - 1',
        (d) => {
          const h = (d.endpoints[KEY] as Json)['histogram'] as { counts: number[] };
          h.counts = [...h.counts, 0];
        },
      ],
      [
        'descending edges',
        (d) => {
          const h = (d.endpoints[KEY] as Json)['histogram'] as { edges: number[] };
          h.edges = [...h.edges].reverse();
        },
      ],
      [
        'counts do not sum to the retained durations',
        (d) => {
          const h = (d.endpoints[KEY] as Json)['histogram'] as { counts: number[] };
          h.counts = h.counts.map((c, i) => (i === 0 ? c + 1 : c));
        },
      ],
      [
        'requests + omitted differ from requestCount',
        (d) => {
          const w = breakdown(d).waterfalls[0] as Json;
          w['omitted'] = 1;
        },
      ],
      [
        'violatedKeys is not min(10, violatedKeyCount) long',
        (d) => {
          const t = breakdown(d).tests[0] as Json;
          t['violatedKeyCount'] = 12;
        },
      ],
    ];
    for (const [name, change] of cases) expect(verdicts(change), name).toEqual([true, false]);
  });
});

describe('formats without custom measurements (02-REQ-33, D-32)', () => {
  const raw = (...path: string[]): string => readFileSync(join(GOLDEN_DIR, ...path), 'utf8');
  const reportV2Text = raw('run-report', 'v2', 'full-run.json');
  const reportV2 = JSON.parse(reportV2Text) as Json & {
    custom: Json;
    evaluation: { counts: Json };
    thresholdFiles: { kind: string }[];
  };

  test('02-AC-18 the v2 golden report with custom keys migrates to a valid v3 report without them', () => {
    // The golden really has what the migration removes.
    expect(reportV2['schemaVersion']).toBe(2);
    expect(Object.keys(reportV2.custom).length).toBeGreaterThan(0);
    expect(reportV2.evaluation.counts['custom']).toBeDefined();
    expect(reportV2.thresholdFiles.some((f) => f.kind === 'custom')).toBe(true);
    expect(reportV2Text).toContain('"custom"');

    const result = parseRunReport(reportV2Text, 'v2.json');
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const migrated = result.value as unknown as Json & typeof reportV2;
    expect(migrated['schemaVersion']).toBe(3);
    expect(migrated).not.toHaveProperty('custom');
    expect(migrated.evaluation.counts).not.toHaveProperty('custom');
    expect(migrated.thresholdFiles.map((f) => f.kind)).toEqual(
      reportV2.thresholdFiles.filter((f) => f.kind !== 'custom').map((f) => f.kind),
    );
    // No custom limit or T is left in the config snapshot; warnings are kept as they are.
    expect(JSON.stringify(migrated['config'])).not.toContain('"custom"');
    expect(migrated['warnings']).toEqual(reportV2['warnings']);
    // Everything else is unchanged.
    expect(migrated['endpoints']).toEqual(reportV2['endpoints']);
    expect(migrated['testBreakdown']).toEqual(reportV2['testBreakdown']);
  });

  test('02-AC-18 the v1 golden report migrates through v2 to a valid v3 report', () => {
    const result = parseRunReport(raw('run-report', 'v1', 'full-run.json'), 'v1.json');
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const migrated = result.value as unknown as Json & { evaluation: { counts: Json } };
    expect(migrated['schemaVersion']).toBe(3);
    expect(migrated).not.toHaveProperty('custom');
    expect(migrated.evaluation.counts).not.toHaveProperty('custom');
    expect(JSON.stringify(migrated)).not.toMatch(/"kind":"custom"/u);
  });

  test('02-AC-18 a v1 api thresholds file migrates to v2 with the same entries', () => {
    const v1Text = raw('thresholds', 'v1', 'generated-api-file.json');
    const v1 = JSON.parse(v1Text) as Json;
    expect(v1['schemaVersion']).toBe(1);
    const result = parseThresholdsFile(v1Text, 'pw-perf-thresholds.api.json', 'api');
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.value.migratedFrom).toBe(1);
    expect(result.value.file).toEqual({ ...v1, schemaVersion: 2 });
  });

  test('02-AC-18 a thresholds file of kind custom gives SCHEMA_VALIDATION_FAILED in v1 and v2', () => {
    const v1 = JSON.parse(
      raw('thresholds', 'v1', 'SCHEMA_VALIDATION_FAILED-custom-kind.json'),
    ) as Json;
    expect(v1).toMatchObject({ schemaVersion: 1, kind: 'custom' });
    for (const doc of [v1, { ...v1, schemaVersion: 2 }]) {
      const result = parseThresholdsFile(text(doc), 'pw-perf-thresholds.api.json', 'api');
      expect(!result.ok && result.issues[0]).toMatchObject({
        code: 'SCHEMA_VALIDATION_FAILED',
        problems: [{ pointer: '/kind' }],
      });
    }
  });

  test('02-AC-18 a v1 sample batch is a version mismatch, a v2 batch with custom is invalid', () => {
    const v1 = loadCases('samples').find((c) => c.file === 'SCHEMA_VERSION_MISMATCH-1.json');
    const v1Input = v1?.input as Json;
    expect(v1Input).toMatchObject({ schemaVersion: 1, custom: expect.any(Array) });
    const old = parseSampleBatch(text(v1Input), 'login');
    expect(!old.ok && old.issues[0]?.code).toBe('SCHEMA_VERSION_MISMATCH');
    const withCustom = parseSampleBatch(text({ ...v1Input, schemaVersion: 2 }), 'login');
    expect(!withCustom.ok && withCustom.issues[0]).toMatchObject({
      code: 'SCHEMA_VALIDATION_FAILED',
      problems: [{ pointer: '', message: expect.stringContaining('custom') }],
    });
  });
});
