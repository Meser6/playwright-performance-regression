// Checks the user documentation in docs/ against the code: every error and warning code emitted
// by src/ has its own section in docs/troubleshooting.md (13-AC-06), and no docs file refers to
// specification IDs, which mean nothing to users.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = join(import.meta.dirname, '../..');
const docsDir = join(root, 'docs');

/** Prefixes of the issue codes. Constants such as env variable names use other prefixes. */
const PREFIXES = [
  'ATTACHMENT',
  'CHECK',
  'CLI',
  'COLLECTOR',
  'CONFIG',
  'EVAL',
  'HTML',
  'INIT',
  'MERGE',
  'MODE',
  'NORMALIZE',
  'NOT_WRAPPED',
  'OUTCOME',
  'REPORT',
  'REPORTER',
  'RUN',
  'SCHEMA',
  'SHARD',
  'STATS',
  'STEPS',
  'TESTS',
  'THRESHOLDS',
];
const CODE = `(?:${PREFIXES.join('|')})_[A-Z0-9_]+`;

/** Withdrawn codes: their sections stay, marked "withdrawn in <version>", for old CI logs. */
const WITHDRAWN = ['RUN_SHARDED'];

/**
 * Codes appear in src/ in two forms:
 * - as a whole string literal, e.g. `code: 'THRESHOLDS_FILE_MISSING'` or a union type member;
 * - at the start of a message printed or thrown without an Issue object, e.g.
 *   `` `COLLECTOR_ATTACH_FAILED: ...` `` or `${PACKAGE_NAME}: OUTCOME_WRITE_FAILED: ...`.
 * Identifiers of constants (`CONFIG_FILE_BASENAME`, `RUN_REPORT_FORMAT`) are never quoted and
 * never followed by ": " inside a string, so they are not matched.
 */
const LITERAL = new RegExp(`['"\`](${CODE})['"\`]`, 'gu');
const MESSAGE_PREFIX = new RegExp(`(?:['"\`]|: )(${CODE}): `, 'gu');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name));
}

function codesInSource(): Set<string> {
  const codes = new Set<string>();
  for (const file of sourceFiles(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of [LITERAL, MESSAGE_PREFIX]) {
      for (const match of text.matchAll(pattern)) codes.add(match[1] as string);
    }
  }
  return codes;
}

function documentedCodes(): Set<string> {
  const text = readFileSync(join(docsDir, 'troubleshooting.md'), 'utf8');
  return new Set([...text.matchAll(/^### ([A-Z][A-Z0-9_]+)\s*$/gmu)].map((m) => m[1] as string));
}

describe('docs', () => {
  test('13-AC-06 every code emitted by src/ has a section in docs/troubleshooting.md', () => {
    const codes = codesInSource();
    // Guards the extraction itself: about a hundred codes exist today.
    expect(codes.size).toBeGreaterThanOrEqual(85);
    for (const known of [
      'CONFIG_INVALID_VALUE',
      'COLLECTOR_ATTACH_FAILED',
      'OUTCOME_WRITE_FAILED',
    ]) {
      expect(codes).toContain(known);
    }
    const documented = documentedCodes();
    const missing = [...codes].filter((code) => !documented.has(code)).sort();
    expect(missing, 'codes without a "### CODE" section').toEqual([]);
  });

  test('13-AC-06 docs/troubleshooting.md has no section for a code that src/ no longer emits', () => {
    const codes = codesInSource();
    const stale = [...documentedCodes()]
      .filter((code) => !codes.has(code) && !WITHDRAWN.includes(code))
      .sort();
    expect(stale, 'sections of codes that do not exist').toEqual([]);
  });

  test('13-AC-06 a withdrawn code is no longer emitted and its section says since when', () => {
    const codes = codesInSource();
    const text = readFileSync(join(docsDir, 'troubleshooting.md'), 'utf8');
    for (const code of WITHDRAWN) {
      expect(codes.has(code), code).toBe(false);
      const section = text.split(/^### /mu).find((s) => s.startsWith(`${code}\n`)) ?? '';
      expect(section, code).toMatch(/withdrawn in \d+\.\d+\.\d+/iu);
    }
  });

  test('no user documentation file refers to specification IDs', () => {
    const specId =
      /\b\d{2}-(?:REQ|AC|D|PERF|STAT)-\d+\b|\bD-\d{2}\b|\bADR-\d{4}\b|\b(?:V|NF|P|R|S)-\d{2}\b/gu;
    const files = [
      ...readdirSync(docsDir, { recursive: true, encoding: 'utf8' })
        .filter((name) => name.endsWith('.md'))
        .map((name) => join(docsDir, name)),
      join(root, 'README.md'),
      ...readdirSync(join(root, 'examples'), { recursive: true, encoding: 'utf8' })
        .filter((name) => name.endsWith('.md') && !name.includes('node_modules'))
        .map((name) => join(root, 'examples', name)),
    ];
    expect(files.length).toBeGreaterThan(3);
    const found = files.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(specId)].map(
        (m) => `${relative(root, file)}: ${m[0]}`,
      ),
    );
    expect(found).toEqual([]);
  });
});
