// End-to-end tests of the setup wizard (04, chapter 4.10; 12, chapter 6: init-*): copies of the
// init projects with the package and @playwright/test linked into node_modules. The wizard runs
// in this process on the real file system as a terminal session with every default answer (it
// only writes in a terminal, 04-D-38), then a real thresholds run with Chromium against the demo
// server; the built binary runs without a terminal. Needs `pnpm build` and the Chromium of the
// installed Playwright.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { main } from '../../src/cli/main.ts';
import { nodeHost } from '../../src/cli/node-host.ts';
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
const playwright = join(root, 'node_modules/@playwright/test/cli.js');
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

/**
 * The wizard in `cwd` as a terminal session that takes every default answer (Enter) and "no" to
 * the check question (04-REQ-58).
 */
async function setUp(cwd: string): Promise<CliRun & { asked: string[] }> {
  let stdout = '';
  let stderr = '';
  const asked: string[] = [];
  const host = {
    ...nodeHost(),
    cwd,
    env: { NO_COLOR: '1' },
    stdin: { isTTY: true },
    stdout: { write: (t: string) => (stdout += t), isTTY: true },
    stderr: { write: (t: string) => (stderr += t) },
    createPrompt: () => ({
      ask: async (question: string) => {
        asked.push(question);
        return /Run a check now\?/u.test(question) ? 'n' : '';
      },
      close: () => undefined,
    }),
  };
  const status = await main([], host);
  return { status, stdout, stderr, asked };
}

function cleanEnv(): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('PW_PERF_')),
  );
}

/** `node <args>` in `cwd`; stdin is a pipe that stays open (no terminal). */
function runNode(args: string[], cwd: string, env: Record<string, string> = {}): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...cleanEnv(), CI: '', NO_COLOR: '1', DEMO_URL: server.url, ...env },
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

describe('setup wizard', () => {
  for (const name of ['esm-ts', 'cjs-js']) {
    test(
      `04-AC-17 the default answers in ${name} give a working integration with the golden diff`,
      async () => {
        const dir = linkedCopy(`init-${name}`);
        const before = snapshot(dir);
        const init = await setUp(dir);
        expect(init.status, init.stdout + init.stderr).toBe(0);
        expect(snapshotDiff(before, snapshot(dir))).toBe(
          readFileSync(join(INIT_GOLDEN, `${name}-defaults.diff`), 'utf8'),
        );

        const run = await runNode([playwright, 'test'], dir, {
          PW_PERF_MODE: 'thresholds',
          PW_PERF_PASSES: '5',
        });
        expect(run.status, run.stdout + run.stderr).toBe(0);
        expect(run.stdout).toContain('thresholds derived');
        expect(readdirSync(dir).filter((f) => f.startsWith('pw-perf-thresholds.'))).toEqual([
          'pw-perf-thresholds.json',
          'pw-perf-thresholds.steps.json',
        ]);
        // 04-REQ-75: the wizard's empty step file stays empty without test.step blocks (10-REQ-14).
        const steps = JSON.parse(
          readFileSync(join(dir, 'pw-perf-thresholds.steps.json'), 'utf8'),
        ) as { entries: object };
        expect(steps.entries).toEqual({});
        const api = JSON.parse(readFileSync(join(dir, 'pw-perf-thresholds.json'), 'utf8')) as {
          entries: object;
        };
        expect(Object.keys(api.entries).length).toBeGreaterThan(0);
        expect(run.stdout + run.stderr).not.toContain('THRESHOLDS_MANUAL_FILE');
      },
      RUN_TIMEOUT,
    );
  }

  test(
    '04-AC-57 the defaults in import-swap change the test imports, show no red box and measure',
    async () => {
      const dir = linkedCopy('init-import-swap');
      const before = snapshot(dir);
      const init = await setUp(dir);
      expect(init.status, init.stdout + init.stderr).toBe(0);
      expect(snapshotDiff(before, snapshot(dir))).toBe(
        readFileSync(join(INIT_GOLDEN, 'imports-only-defaults.diff'), 'utf8'),
      );
      expect(init.stdout).not.toContain('INIT_TEST_OBJECT_MANUAL');
      expect(init.asked.some((q) => /Run a check now\?/u.test(q))).toBe(true);

      const run = await runNode([playwright, 'test'], dir, {
        PW_PERF_MODE: 'thresholds',
        PW_PERF_PASSES: '5',
      });
      expect(run.status, run.stdout + run.stderr).toBe(0);
      expect(run.stdout).toContain('thresholds derived');
      expect(run.stdout + run.stderr).not.toContain('TESTS_NOT_INSTRUMENTED');
    },
    RUN_TIMEOUT,
  );

  test('04-AC-18 the wizard in existing-project keeps the config wrapper and the test objects and prints INIT_MANUAL_STEP', async () => {
    const dir = linkedCopy('init-existing-project');
    const before = snapshot(dir);
    const run = await setUp(dir);
    expect(run.status, run.stderr).toBe(0);
    const after = snapshot(dir);
    for (const file of ['playwright.config.ts', 'tests/fixtures.ts', 'tests/a11y.ts']) {
      expect(after.get(file), file).toBe(before.get(file));
    }
    expect(run.stderr).toContain('warning INIT_MANUAL_STEP: playwright.config.ts was not changed');
    expect(run.stdout).toContain(
      'Files with .extend() and the number of test files that import each:',
    );
    expect(run.stdout).toContain('Wrap the one your tests import: tests/fixtures.ts');
    expect(run.stderr).toContain('withPerf(otherWrapper(defineConfig({ ... })), perfConfig)');
  });

  test('04-AC-19 a second run changes nothing; without a terminal the binary does not wait and writes nothing', async () => {
    const dir = linkedCopy('init-esm-ts');
    const untouched = snapshot(dir);
    // stdin is an open pipe: the wizard must not wait for input.
    const noTty = await runNode([cli], dir);
    expect(noTty.status, noTty.stderr).toBe(0);
    expect(noTty.stderr).toContain('no terminal');
    expect(snapshot(dir)).toEqual(untouched);

    expect((await setUp(dir)).status).toBe(0);
    const done = snapshot(dir);
    const second = await setUp(dir);
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain('Nothing to change');
    expect(snapshot(dir)).toEqual(done);
  });
});
