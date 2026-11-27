// Runs real Playwright with Chromium on test/integration/projects/operations against the demo
// server, in perf mode, with the built package (dist/): operation keys of GraphQL and tRPC (18).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { parseOutcome, parseRunReport } from '../../src/core/schema/index.ts';
import type { Outcome, RunReport } from '../../src/core/types/index.ts';
import { startDemoServer } from '../demo-server/server.ts';
import type { DemoServer } from '../demo-server/server.ts';

const root = join(import.meta.dirname, '../..');
const project = join(import.meta.dirname, 'projects/operations');
const playwrightCli = join(root, 'node_modules/@playwright/test/cli.js');
const RUN_TIMEOUT = 180_000;
const MARKER = 'pw-perf-body-marker-7731';

let scratch = '';
let server: DemoServer;
let runs = 0;

beforeAll(async () => {
  if (!existsSync(join(root, 'dist/reporter.js'))) {
    throw new Error('The integration tests use the built package: run "pnpm build" first.');
  }
  scratch = mkdtempSync(join(tmpdir(), 'pw-perf-operations-'));
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
  report: RunReport;
  outcome: Outcome;
  /** Every file the run wrote under its output directory, as text. */
  written: string;
}

function readAll(dir: string): string {
  if (!existsSync(dir)) return '';
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8'))
    .join('\n');
}

function runPlaywright(env: Record<string, string>): Promise<Run> {
  const out = join(scratch, `run-${++runs}`);
  mkdirSync(out);
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('PW_PERF_')),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [playwrightCli, 'test'], {
      cwd: project,
      env: { ...clean, CI: '', NO_COLOR: '1', INTEGRATION_OUT: out, DEMO_URL: server.url, ...env },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (status) => {
      try {
        const dir = join(out, 'reports/pw-perf');
        const report = parseRunReport(readFileSync(join(dir, 'report.json'), 'utf8'), 'report');
        const outcome = parseOutcome(readFileSync(join(dir, 'outcome.json'), 'utf8'), 'outcome');
        if (!report.ok || !outcome.ok) throw new Error(output);
        resolve({
          status,
          output,
          out,
          report: report.value,
          outcome: outcome.value,
          written: readAll(out),
        });
      } catch (error) {
        reject(error instanceof Error ? new Error(`${error.message}\n${output}`) : error);
      }
    });
  });
}

async function setDelays(delays: Record<string, number>): Promise<void> {
  const response = await fetch(`${server.url}/__control`, {
    method: 'POST',
    body: JSON.stringify({ delays }),
  });
  expect(response.status).toBe(200);
}

const keys = (run: Run): string[] => Object.keys(run.report.endpoints).sort();

describe('operation keys with real Playwright (18)', () => {
  test(
    '18-AC-02 18-AC-03 18-AC-04 18-AC-06 a key per operation; only the slowed operation fails',
    async () => {
      await setDelays({});
      const dir = join(scratch, 'thresholds');
      const derived = await runPlaywright({
        PW_PERF_MODE: 'thresholds',
        OPERATIONS: '1',
        THRESHOLDS_DIR: dir,
      });
      expect(derived.outcome.exitCode, derived.output).toBe(0);
      expect(keys(derived)).toEqual([
        'GET /api/trpc#a.get+b.list',
        'GET /page',
        'POST /graphql#CreateOrder',
        'POST /graphql#GetTickets',
        'request POST /graphql#X',
      ]);
      const thresholds = readFileSync(join(dir, 'pw-perf-thresholds.json'), 'utf8');
      expect(thresholds).toContain('"POST /graphql#CreateOrder"');

      // One operation is slowed by 800 ms; the other keys of the same URL stay as they were.
      await setDelays({ 'POST /graphql#CreateOrder': 800 });
      const slowed = await runPlaywright({
        PW_PERF_MODE: 'test',
        OPERATIONS: '1',
        THRESHOLDS_DIR: dir,
      });
      await setDelays({});
      const failed = Object.entries(slowed.report.endpoints)
        .filter(([, a]) => a.evaluation.result === 'fail')
        .map(([key]) => key);
      expect(failed, slowed.output).toEqual(['POST /graphql#CreateOrder']);
      expect(slowed.outcome.exitCode).not.toBe(0);
      expect(slowed.report.thresholdFiles[0]?.status).toBe('loaded');

      // 18-AC-04: the body never lands in the batches, the reports or the thresholds files.
      for (const run of [derived, slowed]) {
        expect(run.written).toContain('pw-perf-samples');
        // The batch is a JSON text inside the JSON line of the record reporter.
        expect(run.written).toContain('\\"operation\\":[\\"GetTickets\\"]');
        expect(run.written).not.toContain(MARKER);
      }
      expect(readAll(dir)).not.toContain(MARKER);
      expect(readFileSync(join(slowed.out, 'reports/pw-perf/report.html'), 'utf8')).not.toContain(
        MARKER,
      );
    },
    RUN_TIMEOUT,
  );

  test(
    '18-AC-02 without keys.operations one key for every GraphQL call',
    async () => {
      const run = await runPlaywright({ PW_PERF_MODE: 'test' });
      expect(run.outcome.exitCode, run.output).toBe(0);
      expect(keys(run)).toEqual([
        'GET /api/trpc/b.list,a.get?batch&input',
        'GET /page',
        'POST /graphql',
        'request POST /graphql',
      ]);
      expect(run.report.endpoints['POST /graphql']?.count).toBe(30);
      expect(run.written).not.toContain('"operation"');
    },
    RUN_TIMEOUT,
  );
});
