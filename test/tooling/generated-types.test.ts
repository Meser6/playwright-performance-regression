import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const root = join(import.meta.dirname, '../..');

test('02-AC-02 generated types match the output of the generator', () => {
  const output = execFileSync(process.execPath, ['scripts/generate-types.mjs', '--check'], {
    cwd: root,
    encoding: 'utf8',
  });
  expect(output).toContain('up to date');
});
