import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { DEFAULT_CONFIG, expandSteps, resolveConfig } from '../../src/core/config/index.ts';
import type { ConfigOverrides, PerfConfigInput } from '../../src/core/config/index.ts';
import { GOLDEN_DIR } from './golden.ts';
import { createAjv, validator } from './schemas.ts';

// Contract between config resolution and schemas/config.schema.json (03-REQ-05, 03-REQ-08):
// defaults come from the schema, snapshots pass the schema, and the golden configs in
// test/golden/config/ (12-REQ-14) give the expected codes.

interface ConfigCase {
  file: string;
  dir: string;
  name: string;
  input: unknown;
  source?: ConfigOverrides['source'];
  /** "valid": the schema accepts the input; only resolveConfig's own checks reject it. */
  schemaVerdict?: 'valid';
  expected: { ok: true } | { code: string; paths?: string[] };
}

function loadConfigCases(): ConfigCase[] {
  const base = join(GOLDEN_DIR, 'config');
  return readdirSync(base)
    .sort()
    .flatMap((dir) =>
      readdirSync(join(base, dir))
        .sort()
        .map((file) => {
          const data = JSON.parse(readFileSync(join(base, dir, file), 'utf8')) as ConfigCase;
          return { ...data, file, dir };
        }),
    );
}

const ajv = createAjv();
const validateConfig = validator(ajv, 'config.schema.json');

function ajvDefaults(): unknown {
  const config = {};
  validator(createAjv({ useDefaults: true }), 'config.schema.json')(config);
  return config;
}

describe('config defaults and snapshot follow the schema', () => {
  test('03-AC-01 DEFAULT_CONFIG is the schema defaults applied to {} and its snapshot is valid', () => {
    expect(DEFAULT_CONFIG).toEqual(ajvDefaults());
    const result = resolveConfig(undefined, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.snapshot).toEqual({
      ...DEFAULT_CONFIG,
      measure: { ...DEFAULT_CONFIG.measure, steps: expandSteps(false) },
    });
    expect(validateConfig(result.value.snapshot), JSON.stringify(validateConfig.errors)).toBe(true);
  });

  test('a snapshot with RegExp patterns and a key builder passes the schema (02-REQ-17)', () => {
    const result = resolveConfig(
      {
        measure: { include: [/^https:\/\/api\./iu], exclude: ['/health'] },
        keys: { extraIdPatterns: [{ regex: '^v\\d+$' }], keyBuilder: () => undefined },
      },
      { env: 'ci', passes: 3 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(validateConfig(result.value.snapshot), JSON.stringify(validateConfig.errors)).toBe(true);
    expect(JSON.parse(JSON.stringify(result.value.snapshot))).toEqual(result.value.snapshot);
  });
});

describe('golden configs (test/golden/config)', () => {
  const cases = loadConfigCases();

  test('every invalid case is named after its expected code (12-REQ-15)', () => {
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases.filter((x) => x.dir === 'invalid')) {
      expect('code' in c.expected && c.file.startsWith(`${c.expected.code}-`), c.file).toBe(true);
    }
  });

  test.each(cases.map((c) => [`${c.dir}/${c.file}`, c] as const))('%s', (_, c) => {
    const result = resolveConfig(c.input as PerfConfigInput, { source: c.source ?? 'json' });
    const schemaValid = validateConfig(c.input);
    if ('ok' in c.expected) {
      expect(result.ok, JSON.stringify(result.ok ? null : result.issues)).toBe(true);
      expect(schemaValid).toBe(true);
      if (result.ok) expect(validateConfig(result.value.snapshot)).toBe(true);
      return;
    }
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code)).toContain(c.expected.code);
    if (c.expected.paths !== undefined) {
      expect(result.issues.map((i) => i.path)).toEqual(c.expected.paths);
    }
    expect(schemaValid).toBe(c.schemaVerdict === 'valid');
  });
});

/** Paths of the scalar and array options in DEFAULT_CONFIG. */
function leafOptions(node: unknown, prefix: string[] = []): string[][] {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return [prefix];
  const entries = Object.entries(node);
  return entries.length === 0
    ? []
    : entries.flatMap(([name, value]) => leafOptions(value, [...prefix, name]));
}

function withValue(path: string[], value: unknown): Record<string, unknown> {
  return path.reduceRight<unknown>((inner, name) => ({ [name]: inner }), value) as Record<
    string,
    unknown
  >;
}

describe('resolveConfig and the schema agree on mistyped options', () => {
  test.each(leafOptions(DEFAULT_CONFIG).map((path) => [path.join('.'), path] as const))(
    '%s with a value of the wrong type is CONFIG_INVALID_TYPE',
    (name, path) => {
      const wrong =
        typeof path.reduce<unknown>(
          (node, key) => (node as Record<string, unknown>)[key],
          DEFAULT_CONFIG,
        ) === 'boolean'
          ? 'yes'
          : true;
      const input = withValue(path, wrong);
      expect(validateConfig(input)).toBe(false);
      const result = resolveConfig(input as PerfConfigInput, {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues.map((i) => [i.code, i.path])).toEqual([['CONFIG_INVALID_TYPE', name]]);
    },
  );
});
