import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const GOLDEN_DIR = join(import.meta.dirname, '../golden');

/** Format directories under test/golden/ and their schema files (12-REQ-14). */
export const FORMATS = {
  samples: 'samples.schema.json',
  'run-report': 'run-report.schema.json',
  thresholds: 'thresholds.schema.json',
  outcome: 'outcome.schema.json',
} as const;
export type Format = keyof typeof FORMATS;

/**
 * One golden case (12-REQ-15). `input` is the document; `inputText` replaces it when the file
 * content is not JSON. `schemaVerdict: "valid"` marks a document the JSON Schema accepts but
 * the parser rejects by a rule the schema cannot express (calendar dates of `until`, 02-REQ-29;
 * kind of the path, 02-REQ-22).
 */
export interface GoldenCase {
  file: string;
  dir: string;
  name: string;
  input?: unknown;
  inputText?: string;
  expectedKind?: 'api' | 'custom';
  schemaVerdict?: 'valid';
  expected: { ok: true } | { code: string; pointers?: string[] };
}

export function caseText(c: GoldenCase): string {
  return c.inputText ?? JSON.stringify(c.input, null, 2);
}

export function loadCases(format: Format): GoldenCase[] {
  const base = join(GOLDEN_DIR, format);
  const cases: GoldenCase[] = [];
  // v<N>/ holds raw documents of older versions, not cases (oldVersionDirs).
  for (const dir of readdirSync(base)
    .filter((d) => !/^v\d+$/.test(d))
    .sort()) {
    for (const file of readdirSync(join(base, dir)).sort()) {
      const data = JSON.parse(readFileSync(join(base, dir, file), 'utf8')) as Omit<
        GoldenCase,
        'file' | 'dir'
      >;
      cases.push({ ...data, file, dir });
    }
  }
  return cases;
}

/** Older format versions kept for migration tests (02-REQ-11): test/golden/<format>/v<N>/. */
export function oldVersionDirs(format: Format): string[] {
  const base = join(GOLDEN_DIR, format);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((d) => /^v\d+$/.test(d))
    .sort();
}
