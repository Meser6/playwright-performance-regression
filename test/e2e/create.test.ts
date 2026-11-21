// End-to-end tests of create-playwright-performance-regression (01-REQ-39): `node create/index.js`
// in a copy of an init project with a fake package manager that records its arguments and links
// the built package into node_modules instead of downloading it. Needs `pnpm build`. POSIX only:
// the fake package managers are shell scripts.
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { copyProject, removeCopies, snapshot } from '../unit/cli/init-helpers.ts';

afterAll(removeCopies);

const root = join(import.meta.dirname, '../..');
const create = join(root, 'create/index.js');
const version = (
  JSON.parse(readFileSync(join(root, 'create/package.json'), 'utf8')) as { version: string }
).version;

/** Shell lines that link the package and @playwright/test like an installation would. */
const LINK = [
  'mkdir -p node_modules/@playwright',
  `ln -s "${join(root, 'node_modules/@playwright/test')}" node_modules/@playwright/test`,
  `ln -s "${root}" node_modules/playwright-performance-regression`,
].join('\n');

/** A directory with a fake `name` command: records its arguments in calls.txt, then `body`. */
function fakeManager(dir: string, name: string, body = LINK): string {
  const bin = join(dir, '..', `fake bin ${name}`);
  mkdirSync(bin, { recursive: true });
  const script = join(bin, name);
  writeFileSync(
    script,
    `#!/bin/sh\necho "${name} $*" >> "${join(dir, '..', 'calls.txt')}"\n${body}\n`,
  );
  chmodSync(script, 0o755);
  return bin;
}

function calls(dir: string): string[] {
  const file = join(dir, '..', 'calls.txt');
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n') : [];
}

function runCreate(
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<{ status: number | null; output: string }> {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('PW_PERF_') && !name.startsWith('npm_'),
    ),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [create, ...args], {
      cwd,
      env: { ...clean, NO_COLOR: '1', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, output }));
  });
}

describe.skipIf(process.platform === 'win32')('create-playwright-performance-regression', () => {
  test('installs the package with npm (no lockfile) and runs the wizard without arguments', async () => {
    const dir = copyProject('init-esm-ts');
    const before = snapshot(dir);
    const bin = fakeManager(dir, 'npm');
    const run = await runCreate([], dir, {
      PATH: `${bin}:${process.env['PATH']}`,
      PW_PERF_DRY_RUN: '1',
    });
    expect(run.status, run.output).toBe(0);
    expect(calls(dir)).toEqual([
      `npm install --save-dev playwright-performance-regression@${version}`,
    ]);
    expect(run.output).toContain('[11/11] Summary');
    expect(run.output).toContain('dry run');
    expect(snapshot(dir)).toEqual(before);
  });

  test('uses the lockfile and the JavaScript entry of the running package manager', async () => {
    const dir = copyProject('init-cjs-js');
    const entry = join(dir, '..', 'pnpm.cjs');
    writeFileSync(
      entry,
      [
        "const { appendFileSync, mkdirSync, symlinkSync } = require('node:fs');",
        `appendFileSync(${JSON.stringify(join(dir, '..', 'calls.txt'))}, 'pnpm.cjs ' + process.argv.slice(2).join(' ') + '\\n');`,
        "mkdirSync('node_modules/@playwright', { recursive: true });",
        `symlinkSync(${JSON.stringify(join(root, 'node_modules/@playwright/test'))}, 'node_modules/@playwright/test');`,
        `symlinkSync(${JSON.stringify(root)}, 'node_modules/playwright-performance-regression');`,
      ].join('\n'),
    );
    const run = await runCreate([], dir, {
      npm_execpath: entry,
      npm_config_user_agent: 'npm/11.0.0 node/v24.0.0',
    });
    expect(run.status, run.output).toBe(0);
    expect(calls(dir)).toEqual([
      `pnpm.cjs add --save-dev playwright-performance-regression@${version}`,
    ]);
    // Already installed: a second run goes straight to init.
    expect((await runCreate([], dir, {})).status).toBe(0);
    expect(calls(dir)).toHaveLength(1);
  });

  test('04-AC-01 yarn by the user agent; a failed installation, arguments or no package.json end with 3', async () => {
    const dir = copyProject('init-esm-ts');
    const failing = fakeManager(dir, 'yarn', 'exit 1');
    const run = await runCreate([], dir, {
      PATH: `${failing}:${process.env['PATH']}`,
      npm_config_user_agent: 'yarn/4.1.0 npm/? node/v24.0.0',
    });
    expect(run.status).toBe(3);
    expect(calls(dir)).toEqual([`yarn add --dev playwright-performance-regression@${version}`]);
    expect(run.output).toContain('the installation ended with exit code 1');
    expect(existsSync(join(dir, 'pw-perf.config.ts'))).toBe(false);

    // 04-AC-01: arguments end with 3 before any installation.
    const args = await runCreate(['--yes'], dir, { PATH: `${failing}:${process.env['PATH']}` });
    expect(args.status).toBe(3);
    expect(args.output).toContain('takes no arguments, got "--yes"');
    expect(calls(dir)).toHaveLength(1);

    rmSync(join(dir, 'package.json'));
    const none = await runCreate([], dir, {});
    expect(none.status).toBe(3);
    expect(none.output).toContain('no package.json');
  });
});
