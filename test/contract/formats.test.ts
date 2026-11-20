import { describe, expect, test } from 'vitest';
import { Sink } from '../../src/core/schema/dsl.ts';
import {
  parseOutcome,
  parseRunReport,
  parseSampleBatch,
  parseThresholdsFile,
} from '../../src/core/schema/index.ts';
import {
  OUTCOME_FORMAT,
  RUN_REPORT_FORMAT,
  SAMPLES_FORMAT,
  THRESHOLDS_FORMAT,
  migrate,
} from '../../src/core/schema/parse.ts';
import type { VersionedFormat } from '../../src/core/schema/parse.ts';
import type { SchemaIssue } from '../../src/core/schema/index.ts';
import type { Result } from '../../src/core/types/index.ts';
import { caseText, FORMATS, loadCases } from './golden.ts';
import type { Format, GoldenCase } from './golden.ts';
import { createAjv, validator } from './schemas.ts';

// Contract between the hand-written validators in src/core/schema and the JSON Schemas
// (01-REQ-36, 02-REQ-01): both give the same verdict on every golden file and on systematic
// mutations of the valid ones.

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function parse(format: Format, text: string, kind: 'api'): Result<unknown, SchemaIssue> {
  switch (format) {
    case 'samples':
      return parseSampleBatch(text, 'golden');
    case 'run-report':
      return parseRunReport(text, 'golden');
    case 'thresholds':
      return parseThresholdsFile(text, 'golden', kind);
    case 'outcome':
      return parseOutcome(text, 'golden');
  }
}

const ajv = createAjv();

const VERSIONED: Record<Format, VersionedFormat> = {
  samples: SAMPLES_FORMAT,
  'run-report': RUN_REPORT_FORMAT,
  thresholds: THRESHOLDS_FORMAT,
  outcome: OUTCOME_FORMAT,
};

/**
 * The document after the migrations the parser applies to an older schemaVersion. The sample
 * batch is never migrated (02-REQ-13).
 */
function migrated(format: Format, document: Json): Json {
  if (format === 'samples') return document;
  const { current, migrations } = VERSIONED[format];
  if (document === null || typeof document !== 'object' || Array.isArray(document)) return document;
  const version = document['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version)) return document;
  if (version < 1 || version >= current) return document;
  return migrate(document, version, current, migrations) as Json;
}

/**
 * Verdict of the checks a JSON Schema cannot express (02-AC-17, 02-REQ-29), on a document the
 * schema accepts: the parser applies them after the schema, so it may reject such a document.
 */
function extraChecksPass(format: Format, document: unknown): boolean {
  const extra = VERSIONED[format].extraChecks;
  if (extra === undefined) return true;
  const sink = new Sink(1);
  extra(document as Record<string, unknown>, sink);
  return sink.problems.length === 0;
}
const kindOf = (c: GoldenCase): 'api' => c.expectedKind ?? 'api';

describe('02-AC-01 core/schema and Ajv agree on the golden files', () => {
  describe.each(Object.keys(FORMATS) as Format[])('golden files: %s', (format) => {
    const cases = loadCases(format);
    const validate = validator(ajv, FORMATS[format]);

    test('has valid and invalid cases; invalid file names carry the expected code', () => {
      expect(cases.some((c) => c.dir === 'valid')).toBe(true);
      expect(cases.some((c) => c.dir === 'invalid')).toBe(true);
      for (const c of cases) {
        if (c.dir === 'valid') expect(c.expected, c.file).toEqual({ ok: true });
        if (c.dir === 'invalid' && 'code' in c.expected) {
          expect(c.file.startsWith(`${c.expected.code}-`), c.file).toBe(true);
        }
      }
    });

    test.each(cases.map((c) => [`${c.dir}/${c.file}`, c] as const))(
      'parser result for %s',
      (_, c) => {
        const result = parse(format, caseText(c), kindOf(c));
        if ('ok' in c.expected) {
          expect(result, JSON.stringify(result)).toEqual({ ok: true, value: expect.anything() });
          return;
        }
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.issues).toHaveLength(1);
        const [issue] = result.issues;
        expect(issue?.code).toBe(c.expected.code);
        expect(issue?.source).toBe('golden');
        expect(issue?.message.startsWith('golden: ')).toBe(true);
        expect(issue?.problems.length).toBeLessThanOrEqual(5);
        const pointers = issue?.problems.map((p) => p.pointer) ?? [];
        for (const pointer of c.expected.pointers ?? [])
          expect(pointers, c.name).toContain(pointer);
      },
    );

    test.each(
      cases.filter((c) => c.input !== undefined).map((c) => [`${c.dir}/${c.file}`, c] as const),
    )('02-AC-01 Ajv and core/schema agree on %s', (_, c) => {
      const coreValid = parse(format, caseText(c), kindOf(c)).ok;
      const schemaValid = validate(c.input);
      expect(coreValid, 'core verdict').toBe('ok' in c.expected);
      expect(schemaValid, JSON.stringify(validate.errors)).toBe(
        'ok' in c.expected || c.schemaVerdict === 'valid',
      );
    });
  });
});

// ---- mutations ------------------------------------------------------------------------------

const REPLACEMENTS: Json[] = [
  null,
  true,
  '',
  'x',
  'GET',
  -1,
  0,
  1,
  1.5,
  600,
  1e3,
  [],
  {},
  ['x'],
  { x: 1 },
];

function setPath(doc: Json, path: (string | number)[], value: Json): Json {
  const [head, ...rest] = path;
  if (head === undefined) return value;
  const container = doc as Record<string | number, Json>;
  container[head] = setPath(container[head] as Json, rest, value);
  return doc;
}

/** Every document obtained from `root` by one small change at one place. */
function mutations(root: Json): [string, Json][] {
  const result: [string, Json][] = [];
  const visit = (node: Json, path: (string | number)[]): void => {
    const label = `/${path.join('/')}`;
    const add = (change: string, value: Json) =>
      result.push([`${label} ${change}`, setPath(structuredClone(root), path, value)]);
    for (const value of REPLACEMENTS) {
      if (JSON.stringify(value) !== JSON.stringify(node)) add(`= ${JSON.stringify(value)}`, value);
    }
    if (Array.isArray(node)) {
      if (node.length > 0) add('duplicate first item', [...node, node[0] as Json]);
      node.forEach((item, i) => visit(item, [...path, i]));
    } else if (node !== null && typeof node === 'object') {
      add('+ extra property', { ...node, extraProperty: 1 });
      for (const key of Object.keys(node)) {
        const { [key]: _removed, ...rest } = node;
        add(`- ${key}`, rest);
        visit(node[key] as Json, [...path, key]);
      }
    }
  };
  visit(root, []);
  return result;
}

/**
 * A large report has thousands of mutants, each validated twice; on a busy CI runner this takes
 * several seconds, more than the default 5 s timeout. The work is fixed, so a slow run is not a
 * flaky result.
 */
const MUTATION_TIMEOUT_MS = 60_000;

describe('02-AC-01 core/schema and Ajv agree on mutated documents', () => {
  describe.each(Object.keys(FORMATS) as Format[])('02-AC-01 mutation agreement: %s', (format) => {
    const validate = validator(ajv, FORMATS[format]);
    const valid = loadCases(format).filter((c) => c.dir === 'valid');
    const accepted: string[] = [];

    test.each(valid.map((c) => [c.file, c] as const))(
      '02-AC-01 Ajv and core/schema agree on every single-point mutation of %s',
      (_, c) => {
        const verdicts = { valid: 0, invalid: 0 };
        const disagreements: string[] = [];
        for (const [label, mutant] of mutations(c.input as Json)) {
          const schemaValid = validate(mutant);
          const coreValid = parse(format, JSON.stringify(mutant), kindOf(c)).ok;
          // An older schemaVersion is migrated first (02-REQ-10), and the parser also applies
          // the checks the schema cannot express (02-AC-17).
          const document = migrated(format, mutant);
          const expected =
            (document === mutant ? schemaValid : validate(document)) &&
            extraChecksPass(format, document);
          if (expected !== coreValid) {
            disagreements.push(`${label}: Ajv ${String(schemaValid)}, core ${String(coreValid)}`);
          }
          verdicts[schemaValid ? 'valid' : 'invalid']++;
          if (schemaValid) accepted.push(label);
        }
        expect(disagreements).toEqual([]);
        expect(verdicts.invalid).toBeGreaterThan(20);
      },
      MUTATION_TIMEOUT_MS,
    );

    test('mutations also produce valid documents, so agreement is checked in both directions', () => {
      expect(accepted.length).toBeGreaterThan(0);
    });
  });
});
