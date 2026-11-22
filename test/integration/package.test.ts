// The published packages as a user gets them: `npm pack` of the built package and of
// create-<pkg>, unpacked into the node_modules of fresh ESM and CommonJS consumer projects that
// import every entry point by name (01-AC-04, 13-AC-02). Needs `pnpm build`; no browser.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  checkPackContents,
  checkPackages,
  MAX_UNPACKED_BYTES,
  npmPack,
} from '../../scripts/check-packages.mjs';

const ROOT = join(import.meta.dirname, '../..');
const NAME = 'playwright-performance-regression';
const TIMEOUT = 60_000;

/** Named exports (with `typeof`) each entry point must have (01, chapter 9). */
const ENTRIES: Record<string, Record<string, string>> = {
  [NAME]: { definePerfConfig: 'function', perfDefaults: 'object' },
  [`${NAME}/config`]: { definePerfConfig: 'function', withPerf: 'function' },
  [`${NAME}/fixture`]: { trackContext: 'function', withPerfFixtures: 'function' },
  [`${NAME}/test`]: { test: 'function', expect: 'function' },
  [`${NAME}/reporter`]: { default: 'function', PerfReporter: 'function' },
};

let scratch = '';
let consumers = '';

/** Unpacks the tarball `file` to `<into>/node_modules/<name>`. */
function unpack(file: string, into: string, name: string): void {
  const target = join(into, 'node_modules', name);
  const temp = join(into, 'unpack');
  mkdirSync(temp, { recursive: true });
  execFileSync('tar', ['-xzf', file, '-C', temp]);
  mkdirSync(join(into, 'node_modules'), { recursive: true });
  renameSync(join(temp, 'package'), target);
  rmSync(temp, { recursive: true, force: true });
}

/** Packs `dir` into `scratch` and returns the tarball path. */
function pack(dir: string): string {
  const output = execFileSync(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', scratch],
    { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32' },
  );
  const [result] = JSON.parse(output) as [{ filename: string }];
  return join(scratch, result.filename);
}

function consumer(type: 'module' | 'commonjs'): string {
  const dir = join(consumers, type);
  mkdirSync(join(dir, 'node_modules/@playwright'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `consumer-${type}`, type }));
  unpack(join(scratch, 'main.tgz'), dir, NAME);
  symlinkSync(
    join(ROOT, 'node_modules/@playwright/test'),
    join(dir, 'node_modules/@playwright/test'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  return dir;
}

/** Runs `source` with Node in `dir` and returns the parsed JSON it prints. */
function runNode(dir: string, args: string[]): unknown {
  const result = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as unknown;
}

const describeExports = `(m) => Object.fromEntries(Object.keys(m).filter((k) => k !== '__esModule' && k !== 'module.exports').sort().map((k) => [k, typeof m[k]]))`;

beforeAll(() => {
  if (!existsSync(join(ROOT, 'dist/index.cjs')) || !existsSync(join(ROOT, 'dist/cli.js'))) {
    throw new Error('The package tests use the built package: run "pnpm build" first.');
  }
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pw-perf-package-')));
  consumers = join(scratch, 'consumer projects');
  renameSync(pack(ROOT), join(scratch, 'main.tgz'));
  renameSync(pack(join(ROOT, 'create')), join(scratch, 'create.tgz'));
}, TIMEOUT);

afterAll(() => {
  if (scratch !== '') rmSync(scratch, { recursive: true, force: true });
});

describe('published packages', () => {
  test(
    '01-AC-04 every entry point imports in an ESM project',
    () => {
      const dir = consumer('module');
      const script = [
        `const describe = ${describeExports};`,
        `const out = {};`,
        ...Object.keys(ENTRIES).map(
          (entry) =>
            `out[${JSON.stringify(entry)}] = describe(await import(${JSON.stringify(entry)}));`,
        ),
        `out.schema = (await import('${NAME}/schemas/config.schema.json', { with: { type: 'json' } })).default.$id;`,
        `out.version = (await import('${NAME}/package.json', { with: { type: 'json' } })).default.version;`,
        `console.log(JSON.stringify(out));`,
      ].join('\n');
      const out = runNode(dir, ['--input-type=module', '-e', script]) as Record<string, unknown>;
      for (const [entry, expected] of Object.entries(ENTRIES)) {
        expect(out[entry], entry).toMatchObject(expected);
      }
      expect(out['schema']).toEqual(expect.stringContaining('config.schema.json'));
      expect(out['version']).toBe(readPackage(ROOT)['version']);
    },
    TIMEOUT,
  );

  test(
    '01-AC-04 every entry point requires in a CommonJS project',
    () => {
      const dir = consumer('commonjs');
      const script = [
        `const describe = ${describeExports};`,
        `const out = {};`,
        ...Object.keys(ENTRIES).map(
          (entry) => `out[${JSON.stringify(entry)}] = describe(require(${JSON.stringify(entry)}));`,
        ),
        `out.schema = require('${NAME}/schemas/config.schema.json').$id;`,
        `out.version = require('${NAME}/package.json').version;`,
        `out.reporterFile = require.resolve('${NAME}/reporter');`,
        `console.log(JSON.stringify(out));`,
      ].join('\n');
      const out = runNode(dir, ['-e', script]) as Record<string, unknown>;
      for (const [entry, expected] of Object.entries(ENTRIES)) {
        expect(out[entry], entry).toMatchObject(expected);
      }
      expect(out['schema']).toEqual(expect.stringContaining('config.schema.json'));
      expect(out['version']).toBe(readPackage(ROOT)['version']);
      expect(out['reporterFile']).toMatch(/reporter\.cjs$/u);
    },
    TIMEOUT,
  );

  test(
    '01-AC-04 the bin of the packed package runs',
    () => {
      const dir = existsSync(join(consumers, 'module'))
        ? join(consumers, 'module')
        : consumer('module');
      // No commands or options (04-REQ-01): an argument prints the error and the help.
      const result = spawnSync(
        process.execPath,
        [join(dir, 'node_modules', NAME, 'dist/cli.js'), '--version'],
        { cwd: dir, encoding: 'utf8' },
      );
      expect(result.status, result.stderr).toBe(3);
      expect(result.stderr).toContain('error CLI_UNKNOWN_COMMAND');
      expect(result.stdout).toContain('Run your usual test command with PW_PERF_MODE set');
    },
    TIMEOUT,
  );

  test(
    '13-AC-02 npm pack of both packages: "files" only, no install scripts, no runtime dependencies',
    () => {
      const main = readPackage(ROOT);
      const create = readPackage(join(ROOT, 'create'));
      expect(checkPackages(main, create, join(ROOT, 'create'))).toEqual([]);
      expect(
        checkPackContents(npmPack(ROOT), main, 'package.json', {
          maxUnpackedBytes: MAX_UNPACKED_BYTES,
          readFile: (path) => readFileSync(join(ROOT, path), 'utf8'),
        }),
      ).toEqual([]);
      expect(checkPackContents(npmPack(join(ROOT, 'create')), create, 'create')).toEqual([]);

      // The manifests inside the tarballs are the checked ones.
      const unpacked = join(scratch, 'unpacked');
      unpack(join(scratch, 'main.tgz'), unpacked, NAME);
      unpack(join(scratch, 'create.tgz'), unpacked, `create-${NAME}`);
      const packedMain = readPackage(join(unpacked, 'node_modules', NAME));
      const packedCreate = readPackage(join(unpacked, 'node_modules', `create-${NAME}`));
      expect(checkPackages(packedMain, packedCreate)).toEqual([]);
      expect(packedMain['dependencies']).toBeUndefined();
      expect(packedCreate['dependencies']).toBeUndefined();
    },
    TIMEOUT,
  );
});

function readPackage(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
}
