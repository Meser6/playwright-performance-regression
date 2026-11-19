import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  anchor,
  generate,
  listOptions,
  markdown,
  sanitize,
} from '../../scripts/build-config-docs.mjs';
import { DEFAULT_CONFIG } from '../../src/core/config/index.ts';

const root = join(import.meta.dirname, '../..');
const docsFile = join(root, 'docs/configuration.md');
const schema = JSON.parse(readFileSync(join(root, 'schemas/config.schema.json'), 'utf8')) as Record<
  string,
  unknown
>;

/** Option paths of the leaves of a config object (empty objects such as keys.origins count). */
function leafPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  const entries = Object.entries(value);
  if (entries.length === 0) return [prefix];
  return entries.flatMap(([name, child]) =>
    leafPaths(child, prefix === '' ? name : `${prefix}.${name}`),
  );
}

describe('build-config-docs', () => {
  test('13-AC-04 docs/configuration.md matches the generator output', async () => {
    expect(readFileSync(docsFile, 'utf8')).toBe(await generate());
    expect(
      execFileSync(process.execPath, [join(root, 'scripts/build-config-docs.mjs'), '--check'], {
        encoding: 'utf8',
      }),
    ).toContain('up to date');
  });

  test('every option of the schema and of DEFAULT_CONFIG has a heading', () => {
    const text = readFileSync(docsFile, 'utf8');
    const headings = new Set(
      [...text.matchAll(/^#{2,3} `([^`]+)`$/gmu)].map((match) => match[1] as string),
    );
    const schemaPaths = listOptions(schema).map((option) => option.path);
    for (const path of [...schemaPaths, ...leafPaths(DEFAULT_CONFIG)]) {
      expect(headings, path).toContain(path);
    }
    // Links in the list of options go to distinct headings.
    expect(new Set(schemaPaths.map(anchor)).size).toBe(schemaPaths.length);
  });

  test('the docs contain no specification references or placeholders', () => {
    const text = readFileSync(docsFile, 'utf8');
    expect(text).not.toMatch(/\b\d{2}-(?:REQ|AC|D)-\d+|\b(?:D|ADR|NF|P|V)-\d{2,4}\b/u);
    expect(text).not.toMatch(/<pkg>|<PKG>/iu);
  });

  test('sanitize removes references and replaces the package placeholders', () => {
    expect(sanitize('What the collector measures (05).')).toBe('What the collector measures.');
    expect(sanitize('Environment label (D-18). Overridden by <PKG>_ENV / --env.')).toBe(
      'Environment label. Overridden by PW_PERF_ENV / --env.',
    );
    expect(sanitize('Projects (D-04, D-13, D-22; behaviour: 04-REQ-18). Auto.')).toBe(
      'Projects. Auto.',
    );
    expect(sanitize('Headroom (10, chapter 5).')).toBe('Headroom.');
    expect(sanitize('Limit (00, 4.5).')).toBe('Limit.');
    expect(sanitize('Upper clamp (self-consistency may exceed it, 10-REQ-05).')).toBe(
      'Upper clamp (self-consistency may exceed it).',
    );
    expect(sanitize('Error rate (lower Wilson bound compared, ADR-0010).')).toBe(
      'Error rate (lower Wilson bound compared).',
    );
    expect(sanitize('Ends with exit code 3 (exit code 3, 09).')).toBe(
      'Ends with exit code 3 (exit code 3).',
    );
    expect(sanitize("A '<pkg>.config.json' file.")).toBe("A 'pw-perf.config.json' file.");
    // Text in parentheses without references stays as it is.
    expect(sanitize("Kept (e.g. 'junit', 'allure-playwright').")).toBe(
      "Kept (e.g. 'junit', 'allure-playwright').",
    );
  });

  test('sanitize fails when a reference is left', () => {
    expect(() => sanitize('See 09-REQ-07 for details.')).toThrow(/specification reference/u);
    expect(() => sanitize('Decided in D-12 and kept.')).toThrow(/D-12/u);
    expect(() => sanitize('Described in chapter 4.')).toThrow(/chapter 4/u);
  });

  test('markdown keeps placeholders and wildcards as written', () => {
    expect(markdown('files are <prefix>.<kind>[.<env>].json.')).toBe(
      'files are `<prefix>.<kind>[.<env>].json`.',
    );
    expect(markdown('headroom (checks.*.margin.smallSample*) when')).toBe(
      'headroom (`checks.*.margin.smallSample*`) when',
    );
  });
});
