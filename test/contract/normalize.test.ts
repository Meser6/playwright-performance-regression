import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../../src/core/config/index.ts';
import type { PerfConfigInput } from '../../src/core/config/index.ts';
import { createKeyBuilder } from '../../src/core/normalize/index.ts';
import { GOLDEN_DIR } from './golden.ts';

interface NormalizeCase {
  id: string;
  title: string;
  config?: PerfConfigInput['keys'];
  context?: { baseOrigins: string[] };
  input: { method: string; url: string };
  expected: { key: string } | { skip: string };
}

const file = JSON.parse(readFileSync(join(GOLDEN_DIR, 'normalize/cases.json'), 'utf8')) as {
  defaultContext: { baseOrigins: string[] };
  cases: NormalizeCase[];
};

describe('07-AC-01 golden normalization cases (07-REQ-17)', () => {
  test('the golden file has unique, consecutive N-NN ids', () => {
    const ids = file.cases.map((c) => c.id);
    expect(ids).toEqual(ids.map((_, i) => `N-${String(i + 1).padStart(2, '0')}`));
  });

  test.each(file.cases.map((c) => [`${c.id} ${c.title}`, c] as const))('%s', (_name, c) => {
    const resolved = resolveConfig({ keys: c.config ?? {} }, {});
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.issues));
    const build = createKeyBuilder(resolved.value.config.keys, c.context ?? file.defaultContext);
    const result = build({ ...c.input, resourceType: 'fetch' });
    if ('key' in c.expected) {
      expect(result).toMatchObject({ ok: true, key: c.expected.key, issues: [] });
    } else {
      expect(result.ok).toBe(false);
      expect(result.issues.map((i) => i.code)).toEqual([c.expected.skip]);
    }
  });
});
