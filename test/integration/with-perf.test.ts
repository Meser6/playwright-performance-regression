// Runs real Playwright on the projects in test/integration/projects/ with the built package
// (dist/, ESM and CJS builds). The tests use no browser, so no browser has to be installed.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const root = join(import.meta.dirname, '../..');
const projects = join(import.meta.dirname, 'projects');
const playwrightCli = join(root, 'node_modules/@playwright/test/cli.js');
const reporterEsm = join(root, 'dist/reporter.js');
const reporterCjs = join(root, 'dist/reporter.cjs');
const TIMEOUT = 60_000;

interface MainRecord {
  sameObject: boolean;
  workers: number;
  reporters: [string, string | undefined][];
  projects: { name: string; repeatEach: number; retries: number; trace: unknown }[];
  registry?: {
    mode: unknown;
    measuredProjects: string[];
    runConditions: unknown;
    passes: number;
    origins: Record<string, string>;
  };
}

interface Execution {
  project: string;
  title: string;
  repeatEachIndex: number;
  retry: number;
  registry?: {
    mode: unknown;
    measuredProjects: string[];
    passes: number;
    origins: Record<string, string>;
  };
}

interface Run {
  status: number | null;
  output: string;
  out: string;
  main: MainRecord;
  executions: Execution[];
}

let scratch = '';

beforeAll(() => {
  if (!existsSync(join(root, 'dist/config.js')) || !existsSync(join(root, 'dist/config.cjs'))) {
    throw new Error('The integration tests use the built package: run "pnpm build" first.');
  }
  scratch = mkdtempSync(join(tmpdir(), 'pw-perf-integration-'));
});

afterAll(() => {
  if (scratch !== '') rmSync(scratch, { recursive: true, force: true });
});

let runs = 0;

function runPlaywright(project: string, env: Record<string, string>, config?: string): Run {
  const out = join(scratch, `run-${++runs}`);
  mkdirSync(out);
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('PW_PERF_')),
  );
  const result = spawnSync(
    process.execPath,
    [playwrightCli, 'test', ...(config === undefined ? [] : ['-c', config])],
    {
      cwd: join(projects, project),
      env: { ...clean, CI: '', INTEGRATION_OUT: out, ...env },
      encoding: 'utf8',
      timeout: TIMEOUT,
    },
  );
  // The package reporter writes its run report to report.dir of the sample project.
  rmSync(join(projects, project, 'pw-perf-results'), { recursive: true, force: true });
  const output = `${result.stdout}${result.stderr}`;
  const read = (name: string): string => {
    const path = join(out, name);
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  };
  const main = read('main.json');
  return {
    status: result.status,
    output,
    out,
    main: (main === '' ? {} : JSON.parse(main)) as MainRecord,
    executions: read('events.jsonl')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Execution),
  };
}

function count(run: Run, project: string): number {
  return run.executions.filter((e) => e.project === project).length;
}

describe('withPerf with real Playwright', () => {
  test(
    '01-AC-03 outside perf mode the config object is returned unchanged and nothing is registered',
    () => {
      const run = runPlaywright('esm-ts', {});
      expect(run.status, run.output).toBe(0);
      expect(run.main.sameObject).toBe(true);
      expect(run.main.workers).toBe(2);
      expect(run.main.projects.map((p) => [p.name, p.repeatEach, p.retries, p.trace])).toEqual([
        ['setup', 1, 1, 'on'],
        ['cleanup', 1, 1, 'on'],
        ['chromium', 1, 1, 'on'],
        ['firefox', 1, 1, 'on'],
        ['webkit', 1, 1, 'on'],
      ]);
      expect(run.main.reporters.map(([name]) => name)).not.toContain(reporterEsm);
      expect(existsSync(join(run.out, 'junit.xml'))).toBe(true);
      expect(run.main.registry).toBeUndefined();
      expect(run.executions).toHaveLength(5);
      expect(run.executions.every((e) => e.registry === undefined)).toBe(true);
    },
    TIMEOUT,
  );

  test(
    '04-AC-09 04-AC-12 04-AC-13 perf mode applies the run conditions and the registry reaches the worker',
    () => {
      // One pass, so main.json and the worker records belong to the same process.
      const run = runPlaywright('esm-ts', { PW_PERF_MODE: 'test', PW_PERF_PASSES: '1' });
      expect(run.status, run.output).toBe(0);
      expect(run.main.sameObject).toBe(false);
      expect(run.main.workers).toBe(1);
      // Only chromium is measured; every project runs once per pass (D-39); retries: 1 of the
      // Playwright config stays (D-38).
      expect(run.main.projects.map((p) => [p.name, p.repeatEach, p.retries, p.trace])).toEqual([
        ['setup', 1, 1, 'off'],
        ['cleanup', 1, 1, 'off'],
        ['chromium', 1, 1, 'off'],
      ]);
      expect([count(run, 'setup'), count(run, 'chromium'), count(run, 'cleanup')]).toEqual([
        1, 1, 1,
      ]);
      expect(count(run, 'firefox') + count(run, 'webkit')).toBe(0);
      expect(run.executions.map((e) => e.retry)).toEqual([0, 0, 0]);
      // Console reporter, the kept reporter and the package reporter; junit and html removed.
      expect(run.main.reporters.map(([name]) => name)).toEqual([
        'dot',
        join(projects, 'esm-ts/record-reporter.mjs'),
        reporterEsm,
      ]);
      expect(existsSync(join(run.out, 'junit.xml'))).toBe(false);
      expect(existsSync(join(run.out, 'html'))).toBe(false);

      const registry = {
        // The worker inherits the run id of the main process (04-REQ-60).
        mode: { mode: 'test', passes: 1, runId: expect.stringMatching(/^\d{4}-/u) },
        measuredProjects: ['chromium'],
        passes: 1,
        origins: { 'https://api.example.com': 'ts' },
      };
      expect(run.main.registry).toEqual({
        ...registry,
        runConditions: {
          overridden: ['workers', 'trace'],
          removedProjects: ['firefox', 'webkit'],
          removedReporters: ['junit', 'html'],
          replacedReporters: ['list'],
        },
      });
      for (const execution of run.executions) expect(execution.registry).toEqual(registry);
    },
    TIMEOUT,
  );

  test(
    '03-AC-18 run.grep filters the measured project only; setup and teardown run in full',
    () => {
      const env = { PW_PERF_MODE: 'test', PW_PERF_PASSES: '1' };
      const none = runPlaywright('esm-ts', { ...env, INTEGRATION_GREP: 'no-such-tag' });
      expect([count(none, 'setup'), count(none, 'chromium'), count(none, 'cleanup')]).toEqual([
        1, 0, 1,
      ]);
      const some = runPlaywright('esm-ts', { ...env, INTEGRATION_GREP: 'MEASURED' });
      expect(some.status, some.output).toBe(0);
      expect([count(some, 'setup'), count(some, 'chromium'), count(some, 'cleanup')]).toEqual([
        1, 1, 1,
      ]);
      // Outside perf mode run.grep does nothing.
      const off = runPlaywright('esm-ts', { INTEGRATION_GREP: 'no-such-tag' });
      expect(off.executions).toHaveLength(5);
    },
    TIMEOUT,
  );

  test(
    '04-AC-13 a reporter listed in run.keepReporters keeps writing its file',
    () => {
      const run = runPlaywright('esm-ts', { PW_PERF_MODE: 'test', INTEGRATION_KEEP_JUNIT: '1' });
      expect(run.status, run.output).toBe(0);
      expect(run.main.reporters.map(([name]) => name)).toContain('junit');
      expect(existsSync(join(run.out, 'junit.xml'))).toBe(true);
    },
    TIMEOUT,
  );

  test(
    '04-AC-12 run.projects ["firefox"] runs only firefox and its dependencies',
    () => {
      const run = runPlaywright('esm-ts', {
        PW_PERF_MODE: 'thresholds',
        PW_PERF_PASSES: '2',
        INTEGRATION_PROJECTS: 'firefox',
      });
      // The tests of this project record no samples, so the derivation refuses (10-REQ-13).
      expect(run.status, run.output).toBe(1);
      expect(run.output).toContain('THRESHOLDS_EMPTY_REPORT');
      expect(run.main.projects.map((p) => [p.name, p.repeatEach])).toEqual([
        ['setup', 1],
        ['cleanup', 1],
        ['firefox', 1],
      ]);
      // Two passes: the setup project and the firefox test run once in each.
      expect([count(run, 'setup'), count(run, 'firefox'), count(run, 'chromium')]).toEqual([
        2, 2, 0,
      ]);
      expect(run.executions[0]?.registry?.measuredProjects).toEqual(['firefox']);
    },
    TIMEOUT,
  );

  test(
    'an invalid mode variable stops the run before any test with the config error',
    () => {
      const run = runPlaywright('esm-ts', { PW_PERF_MODE: 'perf' });
      expect(run.status).not.toBe(0);
      expect(run.output).toContain(
        'playwright-performance-regression: invalid configuration (1 problem)',
      );
      expect(run.output).toContain(
        'PW_PERF_MODE: expected "test", "thresholds" or "check", got "perf"',
      );
      expect(run.executions).toEqual([]);
    },
    TIMEOUT,
  );

  describe('03-AC-07 ESM and CJS projects with .ts, .mjs and .json package configs', () => {
    test.each([
      ['ESM, TypeScript config, pw-perf.config.ts', 'esm-ts', undefined, 'ts', reporterEsm],
      ['ESM, pw-perf.config.mjs', 'esm-ts', 'playwright.mjs.config.ts', 'mjs', reporterEsm],
      ['ESM, pw-perf.config.json', 'esm-ts', 'playwright.json.config.ts', 'json', reporterEsm],
      [
        'CJS, JavaScript config, require(pw-perf.config.ts).default',
        'cjs-js',
        undefined,
        'cjs',
        reporterCjs,
      ],
    ])(
      '03-AC-07 the package config reaches the worker registry: %s',
      (_name, project, config, label, reporter) => {
        const run = runPlaywright(project, { PW_PERF_MODE: 'test' }, config);
        expect(run.status, run.output).toBe(0);
        expect(run.main.registry?.origins).toEqual({ 'https://api.example.com': label });
        expect(run.main.reporters.at(-1)?.[0]).toBe(reporter);
        const measured = run.executions.filter((e) => e.title === 'measured');
        expect(measured.length).toBeGreaterThanOrEqual(2);
        for (const execution of measured) {
          expect(execution.registry?.origins).toEqual({ 'https://api.example.com': label });
          expect(execution.retry).toBe(0);
        }
      },
      TIMEOUT,
    );
  });
});
