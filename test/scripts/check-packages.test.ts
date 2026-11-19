import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { checkPackages, INSTALL_SCRIPTS } from '../../scripts/check-packages.mjs';

const root = join(import.meta.dirname, '../..');
const read = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<string, unknown>;
const main = read('package.json');
const create = read('create/package.json');

describe('check-packages', () => {
  test('13-AC-12 both manifests of the repository pass', () => {
    expect(checkPackages(main, create, join(root, 'create'))).toEqual([]);
    expect(
      execFileSync(process.execPath, [join(root, 'scripts/check-packages.mjs')], {
        encoding: 'utf8',
      }),
    ).toContain('fine');
  });

  test('13-AC-12 a dependency added to create/package.json fails the check', () => {
    expect(checkPackages(main, { ...create, dependencies: { kleur: '^4.0.0' } })).toEqual([
      'create/package.json: "dependencies" must be absent or empty (no runtime dependencies).',
    ]);
    expect(checkPackages(main, { ...create, dependencies: {} })).toEqual([]);
    expect(checkPackages({ ...main, optionalDependencies: { a: '1' } }, create)).toEqual([
      'package.json: "optionalDependencies" must be absent or empty (no runtime dependencies).',
    ]);
  });

  test('13-AC-12 install scripts, extra peer dependencies and different versions fail', () => {
    for (const script of INSTALL_SCRIPTS) {
      expect(checkPackages(main, { ...create, scripts: { [script]: 'node x' } })).toEqual([
        `create/package.json: the install script "${script}" is not allowed.`,
      ]);
    }
    expect(
      checkPackages(main, { ...create, peerDependencies: { '@playwright/test': '*' } }),
    ).toEqual(['create/package.json: unexpected peerDependencies: @playwright/test.']);
    expect(checkPackages(main, { ...create, version: '9.9.9' })).toEqual([
      `create/package.json: version 9.9.9 differs from ${String(main['version'])} of package.json; both packages are released together.`,
    ]);
  });

  test('create publishes one executable file under its own command', () => {
    expect(checkPackages(main, { ...create, files: ['index.js', 'lib'] })).toEqual([
      'create/package.json: "files" must list only the executable ./index.js.',
    ]);
    expect(checkPackages(main, { ...create, bin: { other: './index.js' } })).toEqual([
      'create/package.json: "bin" must have the one command "create-playwright-performance-regression".',
    ]);
    expect(checkPackages(main, { ...create, name: 'create-x' })[0]).toBe(
      'create/package.json: the name must be "create-playwright-performance-regression".',
    );
  });
});
