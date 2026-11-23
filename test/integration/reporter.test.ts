// Runs real Playwright with Chromium on test/integration/projects/reporter against the demo
// server, in perf mode set through PW_PERF_* as the CLI will (04, chapter 4.2), with the built
// package (dist/). Needs the Chromium of the installed Playwright.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { parseOutcome, parseRunReport } from '../../src/core/schema/index.ts';
import type { Outcome, RunReport } from '../../src/core/types/index.ts';
import { createAjv, validator } from '../contract/schemas.ts';
import { startDemoServer } from '../demo-server/server.ts';
import type { DemoServer } from '../demo-server/server.ts';

const root = join(import.meta.dirname, '../..');
const project = join(import.meta.dirname, 'projects/reporter');
const playwrightCli = join(root, 'node_modules/@playwright/test/cli.js');
const RUN_TIMEOUT = 120_000;
const ajv = createAjv();
const validReport = validator(ajv, 'run-report.schema.json');
const validOutcome = validator(ajv, 'outcome.schema.json');

let scratch = '';
let server: DemoServer;
let runs = 0;

beforeAll(async () => {
  if (!existsSync(join(root, 'dist/reporter.js'))) {
    throw new Error('The integration tests use the built package: run "pnpm build" first.');
  }
  scratch = mkdtempSync(join(tmpdir(), 'pw-perf-reporter-'));
  server = await startDemoServer();
});

afterAll(async () => {
  await server?.close();
  if (scratch !== '') rmSync(scratch, { recursive: true, force: true });
});

interface Run {
  status: number | null;
  output: string;
  out: string;
  /** null when no report was written. */
  report: RunReport | null;
  /** null when no outcome file was written. */
  outcome: Outcome | null;
}

function readReport(path: string): RunReport | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  expect(validReport(JSON.parse(text)), JSON.stringify(validReport.errors)).toBe(true);
  const parsed = parseRunReport(text, path);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
}

function readOutcome(path: string): Outcome | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  expect(validOutcome(JSON.parse(text)), JSON.stringify(validOutcome.errors)).toBe(true);
  const parsed = parseOutcome(text, path);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
}

/** Runs Playwright asynchronously (the demo server lives in this process). */
function runPlaywright(env: Record<string, string>, args: string[] = []): Promise<Run> {
  const id = ++runs;
  const out = join(scratch, `run-${id}`);
  mkdirSync(out);
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('PW_PERF_')),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [playwrightCli, 'test', ...args], {
      cwd: project,
      env: {
        ...clean,
        CI: '',
        NO_COLOR: '1',
        INTEGRATION_OUT: out,
        DEMO_URL: server.url,
        ...env,
      },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (status) => {
      try {
        resolve({
          status,
          output,
          out,
          report: readReport(join(out, 'reports/pw-perf', 'report.json')),
          outcome: readOutcome(join(out, 'reports/pw-perf', 'outcome.json')),
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

const codes = (issues: { code: string }[]): string[] => issues.map((i) => i.code);

describe('reporter with real Playwright', () => {
  test(
    'test mode without thresholds files writes report.json, the outcome and the summary',
    async () => {
      const run = await runPlaywright({ PW_PERF_MODE: 'test' });
      expect(run.status, run.output).toBe(0);
      const report = run.report;
      if (report === null) throw new Error(run.output);
      expect(report).toMatchObject({ mode: 'test', configDir: project });
      expect(report.tests).toEqual({
        status: 'passed',
        expected: 20,
        unexpected: 0,
        flaky: 0,
        skipped: 0,
      });
      expect(report.endpoints['GET /api/cart']?.count).toBe(15);
      expect(report.endpoints['GET /api/items/:id']?.testCount).toBe(3);
      expect(report.endpoints['GET /api/orders']?.count).toBe(5);
      expect(report.runConditions).toMatchObject({
        workers: 1,
        projects: [{ name: 'chromium', role: 'measured', repeatEach: 1, retries: 0 }],
      });
      expect(report.passes).toEqual({ planned: 5, completed: 5, failed: [] });
      expect(codes(report.warnings)).toEqual(expect.arrayContaining(['THRESHOLDS_FILE_MISSING']));
      expect(report.toolErrors).toEqual([]);
      expect(run.outcome).toMatchObject({ runId: report.runId, exitCode: 0 });
      expect(run.outcome?.paths.reportJson).toBe(join(run.out, 'reports/pw-perf', 'report.json'));
      expect(run.output).toContain('Tests    │ 4 tests × 5 passes = 20 test runs');
      expect(run.output).toContain('playwright-performance-regression: pass 5/5 done: 4 tests');
      expect(run.output).toContain('PASSED');
    },
    RUN_TIMEOUT,
  );

  test(
    'thresholds mode writes the thresholds files and the diff; test mode then uses them',
    async () => {
      const dir = join(scratch, 'thresholds');
      const derived = await runPlaywright({ PW_PERF_MODE: 'thresholds', THRESHOLDS_DIR: dir });
      expect(derived.status, derived.output).toBe(0);
      expect(readdirSync(dir).sort()).toEqual(['pw-perf-thresholds.json']);
      expect(derived.outcome?.paths.thresholds).toEqual([join(dir, 'pw-perf-thresholds.json')]);
      const diff = derived.outcome?.paths.thresholdsDiff ?? '';
      expect(readFileSync(diff, 'utf8')).toContain('# Thresholds diff');
      expect(derived.output.indexOf('Thresholds: ')).toBeGreaterThan(
        derived.output.indexOf('PASSED'),
      );

      const evaluated = await runPlaywright({ PW_PERF_MODE: 'test', THRESHOLDS_DIR: dir });
      expect(evaluated.status, evaluated.output).toBe(0);
      // Steps are measured by default; this project has none, so no step file (06-REQ-29).
      expect(evaluated.report?.thresholdFiles.map((f) => [f.kind, f.status])).toEqual([
        ['api', 'loaded'],
        ['step', 'missing'],
      ]);
      expect(evaluated.output).toContain('No test.step blocks found');
      const keys = Object.keys(evaluated.report?.endpoints ?? {});
      expect(keys).toContain('GET /api/cart');
      expect(evaluated.report?.evaluation.counts.api.fromFile).toBe(keys.length);
      expect(evaluated.outcome?.exitCode).toBe(0);
    },
    RUN_TIMEOUT,
  );

  test(
    "the wizard's check (PW_PERF_THRESHOLDS_DIR): absolute path, no commit hints (04-REQ-58)",
    async () => {
      const dir = join(scratch, 'check-thresholds');
      const run = await runPlaywright({
        PW_PERF_MODE: 'thresholds',
        PW_PERF_THRESHOLDS_DIR: dir,
      });
      expect(run.status, run.output).toBe(0);
      expect(readdirSync(dir)).toContain('pw-perf-thresholds.json');
      expect(run.output).toContain(`Thresholds: ${join(dir, 'pw-perf-thresholds.json')} (`);
      expect(run.output).toContain('there is nothing to commit');
      expect(run.output).not.toContain('commit the thresholds files');
      expect(run.output).not.toContain('Next: commit');
    },
    RUN_TIMEOUT,
  );

  test(
    '01-AC-07 --list in perf mode writes no report and no outcome and keeps the exit code',
    async () => {
      const run = await runPlaywright({ PW_PERF_MODE: 'test' }, ['--list']);
      expect(run.status, run.output).toBe(0);
      expect(run.report).toBeNull();
      expect(run.outcome).toBeNull();
      expect(run.output).not.toContain('PASSED');

      const none = await runPlaywright({ PW_PERF_MODE: 'test' }, ['--grep', 'matches-no-test']);
      expect(none.report).toBeNull();
      expect(none.outcome).toBeNull();
    },
    RUN_TIMEOUT,
  );

  test(
    '04-AC-11 failed tests within the share give exit code 0, above it 3',
    async () => {
      const few = await runPlaywright({ PW_PERF_MODE: 'test', FAIL_REPEATS: '1' });
      expect(few.outcome?.exitCode, few.output).toBe(0);
      expect(codes(few.report?.warnings ?? [])).toContain('TESTS_FAILED');
      expect(few.report?.tests.unexpected).toBe(1);
      // Playwright keeps its own status (01-REQ-17): the CLI reads the outcome file.
      expect(few.status).toBe(1);

      const many = await runPlaywright({ PW_PERF_MODE: 'test', FAIL_REPEATS: '3' });
      expect(many.outcome?.exitCode, many.output).toBe(3);
      expect(codes(many.outcome?.toolErrors ?? [])).toEqual(['TESTS_FAILED_TOO_MANY']);
      expect(many.status).toBe(1);
    },
    RUN_TIMEOUT,
  );

  test(
    '04-AC-16 retries of the Playwright config stay; both attempts are measured and the test is flaky',
    async () => {
      const run = await runPlaywright({ PW_PERF_MODE: 'test', INTEGRATION_RETRIES: '1' });
      expect(run.report?.tests, run.output).toMatchObject({ flaky: 5, unexpected: 0 });
      expect(run.report?.runConditions.projects[0]?.retries).toBe(1);
      // One call per attempt, two attempts in each of the 5 passes.
      expect(run.report?.endpoints['GET /api/cart']?.count).toBe(10);
      expect(run.report?.endpoints['GET /api/cart']?.fromFailedTests).toBe(5);
      const warnings = codes(run.report?.warnings ?? []);
      expect(warnings).not.toContain('RUN_CONDITIONS_CHANGED');
      expect(warnings).not.toContain('TESTS_FAILED');
      expect(run.outcome?.exitCode).toBe(0);
    },
    RUN_TIMEOUT,
  );
});

describe('environment mode with real Playwright (04-REQ-60 – 04-REQ-62)', () => {
  test(
    '04-AC-39 04-AC-40 outcome.json in report.dir, the Outcome line and the run id of the workers',
    async () => {
      const run = await runPlaywright({ PW_PERF_MODE: 'test', RECORD_RUN_ID: '1' });
      expect(run.status, run.output).toBe(0);
      expect(run.outcome?.exitCode).toBe(0);
      const runId = run.report?.runId ?? '';
      expect(runId).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
      expect(run.outcome?.runId).toBe(runId);
      const seen = readFileSync(join(run.out, 'worker-run-id.txt'), 'utf8').trim().split('\n');
      expect(new Set(seen)).toEqual(new Set([runId]));
      expect(run.output).toContain(
        `Outcome: Playwright exit code 0 · details: performance passed (code 0) in ${join(run.out, 'reports/pw-perf', 'outcome.json')}`,
      );
    },
    RUN_TIMEOUT,
  );

  test(
    '04-AC-39 a failed test without violations: Playwright 1, outcome exit code 0',
    async () => {
      const run = await runPlaywright({ PW_PERF_MODE: 'test', FAIL_REPEATS: '1' });
      expect(run.status, run.output).toBe(1);
      expect(run.outcome?.exitCode).toBe(0);
      expect(codes(run.report?.warnings ?? [])).toContain('TESTS_FAILED');
    },
    RUN_TIMEOUT,
  );

  test(
    '04-AC-40 --reporter=dot fails a test run before the tests, a check only warns',
    async () => {
      const run = await runPlaywright({ PW_PERF_MODE: 'test' }, ['--reporter=dot']);
      expect(run.status, run.output).toBe(1);
      expect(run.output).toContain('--reporter replaces the pw-perf reporter');
      expect(run.report).toBeNull();
      expect(run.outcome).toBeNull();
      const check = await runPlaywright({ PW_PERF_MODE: 'check' }, ['--reporter=dot']);
      expect(check.status, check.output).toBe(0);
      expect(check.output).toContain('warning RUN_REPORTER_FLAG');
    },
    RUN_TIMEOUT,
  );
});
