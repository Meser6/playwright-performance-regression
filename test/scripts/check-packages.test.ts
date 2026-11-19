import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  checkPackContents,
  checkPackages,
  INSTALL_SCRIPTS,
  MAX_PACKED_BYTES,
  MAX_UNPACKED_BYTES,
} from '../../scripts/check-packages.mjs';

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
      'create/package.json: "files" must list only the executable index.js.',
    ]);
    expect(checkPackages(main, { ...create, bin: { other: './index.js' } })).toEqual([
      'create/package.json: "bin" must have the one command "create-playwright-performance-regression".',
    ]);
    expect(checkPackages(main, { ...create, name: 'create-x' })[0]).toBe(
      'create/package.json: the name must be "create-playwright-performance-regression".',
    );
  });
});

describe('check-packages: package contents and size (13-REQ-11)', () => {
  const pack = (paths: string[], unpackedSize = 1000, size = 500) => ({
    files: paths.map((path) => ({ path, size: 1 })),
    unpackedSize,
    size,
  });
  const mainFiles = [
    'package.json',
    'README.md',
    'CHANGELOG.md',
    'LICENSE',
    'dist/index.js',
    'dist/index.cjs',
    'schemas/config.schema.json',
  ];

  test('13-AC-12 a pack with only the files of the "files" field passes', () => {
    expect(checkPackContents(pack(mainFiles), main, 'package.json')).toEqual([]);
    expect(
      checkPackContents(pack(['package.json', 'README.md', 'index.js']), create, 'create'),
    ).toEqual([]);
  });

  test('13-AC-12 files outside "files", test files, prototype and spec-ids.json fail', () => {
    expect(
      checkPackContents(
        pack([...mainFiles, 'test/unit/a.test.ts', 'prototype/x.js', 'spec-ids.json', 'src/a.ts']),
        main,
        'package.json',
      ),
    ).toEqual([
      'package.json: the package contains prototype/x.js, which is not allowed.',
      'package.json: the package contains spec-ids.json, which is not allowed.',
      'package.json: the package contains src/a.ts, which is not listed in "files".',
      'package.json: the package contains test/unit/a.test.ts, which is not allowed.',
    ]);
    expect(checkPackContents(pack(['package.json', 'lib.js']), create, 'create')).toEqual([
      'create: the package contains lib.js, which is not listed in "files".',
      'create: "files" lists index.js, but the package has no such file.',
    ]);
  });

  test('13-AC-12 an entry of "files" missing from the pack fails (package not built)', () => {
    expect(
      checkPackContents(
        pack(mainFiles.filter((path) => !path.startsWith('dist/'))),
        main,
        'package.json',
      ),
    ).toEqual(['package.json: "files" lists dist, but the package has no such file.']);
  });

  test('13-AC-12 source maps with absolute paths fail', () => {
    const maps: Record<string, string> = {
      'dist/a.js.map': JSON.stringify({ sources: ['../src/a.ts'] }),
      'dist/b.js.map': JSON.stringify({ sources: ['/home/runner/work/src/b.ts'] }),
      'dist/c.js.map': JSON.stringify({ sources: ['C:\\work\\src\\c.ts'] }),
      'dist/d.js.map': JSON.stringify({ sources: ['file:///work/src/d.ts'] }),
    };
    expect(
      checkPackContents(pack([...mainFiles, ...Object.keys(maps)]), main, 'package.json', {
        readFile: (path) => maps[path] ?? '',
      }),
    ).toEqual([
      'package.json: the source map dist/b.js.map has an absolute path (/home/runner/work/src/b.ts).',
      'package.json: the source map dist/c.js.map has an absolute path (C:\\work\\src\\c.ts).',
      'package.json: the source map dist/d.js.map has an absolute path (file:///work/src/d.ts).',
    ]);
  });

  test('13-AC-12 a packed size above the limit fails', () => {
    expect(
      checkPackContents(pack(mainFiles, 1000, MAX_PACKED_BYTES + 1), main, 'package.json', {
        maxPackedBytes: MAX_PACKED_BYTES,
      }),
    ).toEqual([
      `package.json: the packed package has ${MAX_PACKED_BYTES + 1} bytes, above the limit of ${MAX_PACKED_BYTES} bytes (scripts/check-packages.mjs).`,
    ]);
    expect(
      checkPackContents(pack(mainFiles, 1000, MAX_PACKED_BYTES), main, 'package.json', {
        maxPackedBytes: MAX_PACKED_BYTES,
      }),
    ).toEqual([]);
  });

  test('13-AC-12 an unpacked size above the limit fails', () => {
    expect(
      checkPackContents(pack(mainFiles, MAX_UNPACKED_BYTES + 1), main, 'package.json', {
        maxUnpackedBytes: MAX_UNPACKED_BYTES,
      }),
    ).toEqual([
      `package.json: the unpacked package has ${MAX_UNPACKED_BYTES + 1} bytes, above the limit of ${MAX_UNPACKED_BYTES} bytes (scripts/check-packages.mjs).`,
    ]);
    expect(
      checkPackContents(pack(mainFiles, MAX_UNPACKED_BYTES), main, 'package.json', {
        maxUnpackedBytes: MAX_UNPACKED_BYTES,
      }),
    ).toEqual([]);
  });
});
