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
  outcomeFile: string;
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
  const outcomeFile = join(out, 'outcome', 'run.outcome.json');
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
        PW_PERF_RUN_ID: `run-${id}`,
        PW_PERF_OUTCOME_FILE: outcomeFile,
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
          outcomeFile,
          report: readReport(join(out, 'pw-perf-results', 'report.json')),
          outcome: readOutcome(outcomeFile),
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
      expect(report).toMatchObject({ runId: 'run-1', mode: 'test', configDir: project });
      expect(report.tests).toEqual({
        status: 'passed',
        expected: 20,
        unexpected: 0,
        flaky: 0,
        skipped: 0,
      });
      expect(report.endpoints['GET /api/cart']?.count).toBe(15);
      expect(report.endpoints['GET /api/items/:id']?.testCount).toBe(3);
      expect(report.custom['checkout:submit']?.count).toBe(5);
      expect(report.runConditions).toMatchObject({
        workers: 1,
        projects: [{ name: 'chromium', role: 'measured', repeatEach: 5, retries: 0 }],
      });
      expect(codes(report.warnings)).toEqual(expect.arrayContaining(['THRESHOLDS_FILE_MISSING']));
      expect(report.toolErrors).toEqual([]);
      expect(run.outcome).toMatchObject({ runId: 'run-1', exitCode: 0 });
      expect(run.outcome?.paths.reportJson).toBe(join(run.out, 'pw-perf-results', 'report.json'));
      expect(run.output).toContain(
        'playwright-performance-regression: perf mode "test": 20 test executions (4 tests × 5 repeats), 1 worker.',
      );
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
      expect(readdirSync(dir).sort()).toEqual([
        'pw-perf-thresholds.api.json',
        'pw-perf-thresholds.custom.json',
      ]);
      expect(derived.outcome?.paths.thresholds).toEqual([
        join(dir, 'pw-perf-thresholds.api.json'),
        join(dir, 'pw-perf-thresholds.custom.json'),
      ]);
      const diff = derived.outcome?.paths.thresholdsDiff ?? '';
      expect(readFileSync(diff, 'utf8')).toContain('# Thresholds diff');
      expect(derived.output.indexOf('Thresholds: ')).toBeGreaterThan(
        derived.output.indexOf('PASSED'),
      );

      const evaluated = await runPlaywright({ PW_PERF_MODE: 'test', THRESHOLDS_DIR: dir });
      expect(evaluated.status, evaluated.output).toBe(0);
      expect(evaluated.report?.thresholdFiles.map((f) => f.status)).toEqual(['loaded', 'loaded']);
      const keys = Object.keys(evaluated.report?.endpoints ?? {});
      expect(keys).toContain('GET /api/cart');
      expect(evaluated.report?.evaluation.counts.api.fromFile).toBe(keys.length);
      expect(evaluated.outcome?.exitCode).toBe(0);
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
    '04-AC-16 retries configured in a test file give RUN_CONDITIONS_CHANGED',
    async () => {
      const run = await runPlaywright({ PW_PERF_MODE: 'test', INTEGRATION_RETRIES: '1' });
      expect(run.report?.tests.flaky, run.output).toBe(5);
      const changed = (run.report?.warnings ?? []).filter(
        (w) => w.code === 'RUN_CONDITIONS_CHANGED',
      );
      // FullProject.retries stays 0: only the results show the retries (04-REQ-19).
      expect(changed.map((w) => w.message)).toEqual([
        '5 test results are retries (retry > 0), although perf mode sets retries to 0; samples of retries are counted.',
      ]);
      expect(run.outcome?.exitCode).toBe(0);
    },
    RUN_TIMEOUT,
  );
});
