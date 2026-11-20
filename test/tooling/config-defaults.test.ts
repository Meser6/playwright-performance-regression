import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test } from 'vitest';

// 03-REQ-05: the defaults exist only in schemas/config.schema.json; DEFAULT_CONFIG is generated
// from it together with the types (generated-types.test.ts checks that it is up to date).
const root = join(import.meta.dirname, '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** Default values distinctive enough not to appear in src/ for another reason. */
const DEFAULT_LITERALS = [
  /\b5000\b/u,
  /\b4000\b/u,
  /\b0\.85\b/u,
  /socket\.io/u,
  /pw-perf-results/u,
];

test('03-AC-02 default values appear in src/ only in generated files', () => {
  const hits = sourceFiles(join(root, 'src')).flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return DEFAULT_LITERALS.filter((literal) => literal.test(text)).map(
      (literal) => `${relative(root, file)}: ${literal.source}`,
    );
  });
  expect(hits).toEqual([]);
  const generated = readFileSync(join(root, 'src/core/config/generated/defaults.ts'), 'utf8');
  for (const literal of DEFAULT_LITERALS) expect(generated).toMatch(literal);
});
