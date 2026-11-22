// End-to-end tests (04 chapter 10): measurement runs in the environment mode (`PW_PERF_MODE=…
// playwright test`, D-35) on test/integration/projects/reporter against the demo server, with
// their exit codes, outcome.json and signals; and the built binary (`node dist/cli.js`), which
// has no commands or options and only starts the wizard (04-REQ-01, D-43). Needs `pnpm build` and
// the Chromium of the installed Playwright.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startDemoServer } from '../demo-server/server.ts';
import type { DemoServer } from '../demo-server/server.ts';
import { copyProject, removeCopies, snapshot } from '../unit/cli/init-helpers.ts';

const root = join(import.meta.dirname, '../..');
const cli = join(root, 'dist/cli.js');
const playwright = join(root, 'node_modules/@playwright/test/cli.js');
const project = join(import.meta.dirname, '../integration/projects/reporter');
const RUN_TIMEOUT = 120_000;
const POSIX = process.platform !== 'win32';

let scratch = '';
let server: DemoServer;
let runs = 0;

beforeAll(async () => {
  if (!existsSync(cli)) {
    throw new Error('The e2e tests use the built package: run "pnpm build" first.');
  }
  // A space in every path of the run.
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pw-perf e2e-')));
  server = await startDemoServer();
});

afterAll(async () => {
  await server?.close();
  // A run ended by SIGTERM leaves its workers to finish writing for a moment.
  if (scratch !== '')
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  removeCopies();
});

interface Run {
  status: number | null;
  /** The signal that ended the process, if any. */
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** stdout and stderr together. */
  output: string;
  out: string;
}

interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** Called with the child process and its output so far on every chunk of output. */
  onOutput?: (child: ChildProcess, output: string) => void;
}

function spawnRun(command: string[], options: RunOptions): Promise<Run> {
  const out = join(scratch, `run ${++runs}`);
  mkdirSync(out);
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('PW_PERF_')),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, command, {
      cwd: options.cwd ?? project,
      env: {
        ...clean,
        CI: '',
        NO_COLOR: '1',
        INTEGRATION_OUT: out,
        DEMO_URL: server.url,
        ...options.env,
      },
    });
    let stdout = '';
    let stderr = '';
    const seen = (): void => options.onOutput?.(child, stdout + stderr);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      seen();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      seen();
    });
    child.on('error', reject);
    child.on('close', (status, signal) => {
      resolve({ status, signal, stdout, stderr, output: stdout + stderr, out });
    });
  });
}

/** `PW_PERF_MODE=<mode> playwright test <args>`; INTEGRATION_OUT is a fresh directory. */
function runMode(
  mode: 'test' | 'thresholds',
  args: string[] = [],
  options: RunOptions = {},
): Promise<Run> {
  return spawnRun([playwright, 'test', ...args], {
    ...options,
    env: { PW_PERF_MODE: mode, ...options.env },
  });
}

const reportPath = (run: Run): string => join(run.out, 'reports/pw-perf', 'report.json');

/** exitCode of reports/pw-perf/outcome.json (04-REQ-62), or null without the file. */
function outcomeCode(run: Run): number | null {
  const file = join(run.out, 'reports/pw-perf', 'outcome.json');
  if (!existsSync(file)) return null;
  return (JSON.parse(readFileSync(file, 'utf8')) as { exitCode: number }).exitCode;
}

/** A thresholds run whose thresholds files other tests reuse. */
let source: Promise<{ run: Run; thresholds: string }> | undefined;
function sourceRun(): Promise<{ run: Run; thresholds: string }> {
  source ??= (async () => {
    const thresholds = join(scratch, 'source thresholds');
    const run = await runMode('thresholds', [], { env: { THRESHOLDS_DIR: thresholds } });
    return { run, thresholds };
  })();
  return source;
}

/** Output after the start banner of the reporter (04-REQ-65). */
const afterBanner = (output: string): string => output.split('╯').slice(1).join('');

describe('environment mode runs', () => {
  test(
    '04-AC-03 a passing measurement run from another directory with -c: exit code 0 and exitCode 0',
    async () => {
      const cwd = join(scratch, 'monorepo root');
      mkdirSync(cwd);
      const run = await runMode('test', ['-c', join(project, 'playwright.config.ts')], {
        cwd,
        env: { PW_PERF_PASSES: '2' },
      });
      expect(run.status, run.output).toBe(0);
      expect(outcomeCode(run)).toBe(0);
      // The start banner of the reporter shows the runs and the subset tip (04-REQ-65).
      expect(run.stdout).toContain('4 tests × 2 passes = 8 test runs');
      expect(run.stdout).toContain('Tip       measure a subset');
      // One absolute Report line at the end of the summary (09-REQ-30).
      const html = join(dirname(reportPath(run)), 'report.html');
      const shown = /^Report: (.+)$/mu.exec(run.stdout)?.[1];
      expect(shown, run.stdout).toBeDefined();
      expect(realpathSync(shown ?? '')).toBe(realpathSync(html));
      expect(readFileSync(html, 'utf8').startsWith('<!doctype html>')).toBe(true);
    },
    RUN_TIMEOUT,
  );

  test(
    '04-AC-03 a blocking violation gives exit code 1 of Playwright and exitCode 2',
    async () => {
      const { run: thresholdsRun, thresholds } = await sourceRun();
      expect(thresholdsRun.status, thresholdsRun.output).toBe(0);
      expect(readdirSync(thresholds).sort()).toEqual(['pw-perf-thresholds.json']);
      const tight = join(scratch, 'tight thresholds');
      cpSync(thresholds, tight, { recursive: true });
      const file = join(tight, 'pw-perf-thresholds.json');
      const content = JSON.parse(readFileSync(file, 'utf8')) as {
        entries: Record<string, Record<string, number>>;
      };
      content.entries['GET /api/cart'] = {
        ...content.entries['GET /api/cart'],
        median: 1,
        percentile: 2,
        p99: 3,
      };
      writeFileSync(file, JSON.stringify(content));
      const run = await runMode('test', [], { env: { THRESHOLDS_DIR: tight } });
      expect(run.status, run.output).toBe(1);
      expect(outcomeCode(run)).toBe(2);
      expect(run.stdout).toMatch(/Outcome: performance failed · exit code 2 in .+outcome\.json/u);
    },
    RUN_TIMEOUT,
  );

  test(
    '04-AC-15 04-AC-03 SIGINT ends a thresholds run with 1 and exitCode 3 and leaves the thresholds files unchanged',
    // Signals between processes are POSIX only; Windows is covered by the OS matrix (13-REQ-09).
    { skip: !POSIX, timeout: RUN_TIMEOUT },
    async () => {
      const { thresholds } = await sourceRun();
      const kept = join(scratch, 'interrupted thresholds');
      cpSync(thresholds, kept, { recursive: true });
      const before = readdirSync(kept).map((f) => readFileSync(join(kept, f)));
      let sent = false;
      const run = await runMode('thresholds', [], {
        env: { THRESHOLDS_DIR: kept, PW_PERF_PASSES: '10' },
        onOutput: (child, output) => {
          // After the first finished test (dot reporter, 04-REQ-32); the start banner has a "·"
          // too, and Playwright ignores a SIGINT while it starts its workers.
          if (!sent && afterBanner(output).includes('·')) {
            sent = true;
            child.kill('SIGINT');
          }
        },
      });
      expect(sent).toBe(true);
      // Interrupted: RUN_INCOMPLETE, so the reporter returns failed and Playwright exits with 1.
      expect(run.status, run.output).toBe(1);
      expect(outcomeCode(run)).toBe(3);
      expect(run.stdout).toContain('RUN_INCOMPLETE');
      expect(readdirSync(kept).map((f) => readFileSync(join(kept, f)))).toEqual(before);
    },
  );

  test(
    '04-AC-03 SIGTERM ends the run by the signal (exit code 143 in a shell)',
    // Signals between processes are POSIX only; Windows is covered by the OS matrix (13-REQ-09).
    { skip: !POSIX, timeout: RUN_TIMEOUT },
    async () => {
      let sent = false;
      const run = await runMode('test', [], {
        env: { PW_PERF_PASSES: '10' },
        onOutput: (child, output) => {
          if (!sent && afterBanner(output).includes('·')) {
            sent = true;
            child.kill('SIGTERM');
          }
        },
      });
      expect(sent).toBe(true);
      expect({ status: run.status, signal: run.signal }, run.output).toEqual({
        status: null,
        signal: 'SIGTERM',
      });
    },
  );
});

describe('the pw-perf binary', () => {
  test('04-AC-01 arguments end with 3, CLI_UNKNOWN_COMMAND and the help', async () => {
    const run = await spawnRun([cli, 'test', '--passes', '2'], {});
    expect(run.status).toBe(3);
    expect(run.stderr).toContain('error CLI_UNKNOWN_COMMAND');
    expect(run.stderr).toContain('PW_PERF_MODE=test <your test command>');
    expect(run.stdout).toContain('Run your usual test command with PW_PERF_MODE set');
    expect(run.stdout).toContain('PW_PERF_NO_TUTORIAL=1');
  });

  test('04-REQ-01 04-AC-19 without arguments and without a terminal: the wizard shows the plan and writes nothing', async () => {
    const dir = copyProject('init-esm-ts');
    const before = snapshot(dir);
    const run = await spawnRun([cli], { cwd: dir });
    expect(run.status, run.output).toBe(0);
    expect(run.stderr).toContain(
      'no terminal: the default answers are used and nothing is written',
    );
    expect(run.stdout).toContain('[10/10] Summary');
    expect(run.stdout).toContain('+++ b/pw-perf.config.ts');
    expect(snapshot(dir)).toEqual(before);
  });
});
