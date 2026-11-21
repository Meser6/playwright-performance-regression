// End-to-end tests of `pw-perf init` with the built CLI (04, chapter 4.10; 12, chapter 6:
// init-*): copies of the init projects with the package and @playwright/test linked into
// node_modules, then a real thresholds run with Chromium against the demo server. Needs
// `pnpm build` and the Chromium of the installed Playwright.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startDemoServer } from '../demo-server/server.ts';
import type { DemoServer } from '../demo-server/server.ts';
import {
  copyProject,
  INIT_GOLDEN,
  removeCopies,
  snapshot,
  snapshotDiff,
} from '../unit/cli/init-helpers.ts';

const root = join(import.meta.dirname, '../..');
const cli = join(root, 'dist/cli.js');
const RUN_TIMEOUT = 120_000;

let server: DemoServer;

beforeAll(async () => {
  if (!existsSync(cli)) {
    throw new Error('The e2e tests run the built CLI: run "pnpm build" first.');
  }
  server = await startDemoServer();
});

afterAll(async () => {
  await server?.close();
  removeCopies();
});

/** A copy of the project whose node_modules links the package and @playwright/test. */
function linkedCopy(name: string): string {
  const dir = copyProject(name);
  mkdirSync(join(dir, 'node_modules/@playwright'), { recursive: true });
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  symlinkSync(
    join(root, 'node_modules/@playwright/test'),
    join(dir, 'node_modules/@playwright/test'),
    type,
  );
  symlinkSync(root, join(dir, 'node_modules/playwright-performance-regression'), type);
  return dir;
}

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** `node dist/cli.js <args>` in `cwd`; stdin is a pipe that stays open (no terminal). */
function runCli(args: string[], cwd: string): Promise<CliRun> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('PW_PERF_')),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      env: { ...env, CI: '', NO_COLOR: '1', DEMO_URL: server.url },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

describe('pw-perf init', () => {
  for (const name of ['esm-ts', 'cjs-js', 'import-swap']) {
    test(
      `04-AC-17 init --yes in ${name} gives a working integration with the golden diff`,
      async () => {
        const dir = linkedCopy(`init-${name}`);
        const before = snapshot(dir);
        const init = await runCli(['init', '--yes'], dir);
        expect(init.status, init.stdout + init.stderr).toBe(0);
        expect(snapshotDiff(before, snapshot(dir))).toBe(
          readFileSync(join(INIT_GOLDEN, `${name}-defaults.diff`), 'utf8'),
        );

        const run = await runCli(['thresholds', '--passes', '5'], dir);
        expect(run.status, run.stdout + run.stderr).toBe(0);
        expect(run.stderr).toContain('thresholds derived');
        expect(readdirSync(dir).filter((f) => f.startsWith('pw-perf-thresholds.'))).toEqual([
          'pw-perf-thresholds.json',
        ]);
      },
      RUN_TIMEOUT,
    );
  }

  test('04-AC-18 init in existing-project keeps the config wrapper and the test objects and prints INIT_MANUAL_STEP', async () => {
    const dir = linkedCopy('init-existing-project');
    const before = snapshot(dir);
    const run = await runCli(['init', '--yes'], dir);
    expect(run.status, run.stderr).toBe(0);
    const after = snapshot(dir);
    for (const file of ['playwright.config.ts', 'tests/fixtures.ts', 'tests/a11y.ts']) {
      expect(after.get(file), file).toBe(before.get(file));
    }
    expect(run.stderr).toContain('warning INIT_MANUAL_STEP: playwright.config.ts was not changed');
    expect(run.stderr).toContain(
      'warning INIT_MANUAL_STEP: tests/a11y.ts, tests/fixtures.ts were not changed',
    );
    expect(run.stderr).toContain('withPerf(otherWrapper(defineConfig({ ... })), perfConfig)');
  });

  test('04-AC-19 a second run changes nothing; without a terminal init does not wait and writes nothing', async () => {
    const dir = linkedCopy('init-esm-ts');
    const untouched = snapshot(dir);
    // stdin is an open pipe: init must not wait for input.
    const noTty = await runCli(['init'], dir);
    expect(noTty.status, noTty.stderr).toBe(0);
    expect(noTty.stderr).toContain('no terminal');
    expect(snapshot(dir)).toEqual(untouched);

    expect((await runCli(['init', '--yes'], dir)).status).toBe(0);
    const setUp = snapshot(dir);
    const second = await runCli(['init', '--yes'], dir);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain('Nothing to change');
    expect(snapshot(dir)).toEqual(setUp);
  });
});
