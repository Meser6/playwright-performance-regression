// Shared helpers of the performance and statistical tests (12, chapter 7). These tests run in the
// nightly and weekly workflows (`pnpm test:perf`, `pnpm test:stats`), not on every push, and do
// not block a merge (12-D-05). Each test writes its measurements to PERF_RESULTS_DIR
// (default perf-test-results/), which the workflows upload as an artifact (12-REQ-12, 12-AC-04).
// Needs `pnpm build` and the Chromium of the installed Playwright.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDemoServer } from '../demo-server/server.ts';
import type { DemoServer } from '../demo-server/server.ts';

export const ROOT = join(import.meta.dirname, '../..');
export const CLI = join(ROOT, 'dist/cli.js');
export const PLAYWRIGHT = join(ROOT, 'node_modules/@playwright/test/cli.js');
/** The reporter integration project: four tests calling /api/items/:id, /api/cart, /api/orders. */
export const DEMO_PROJECT = join(ROOT, 'test/integration/projects/reporter');
const RESULTS_DIR = process.env.PERF_RESULTS_DIR ?? join(ROOT, 'perf-test-results');

export function requireBuild(): void {
  if (!existsSync(CLI)) {
    throw new Error('The performance tests use the built package: run "pnpm build" first.');
  }
}

/** Writes the measurements of one test (by its 12-PERF/12-STAT ID) to the results directory. */
export function recordResult(id: string, result: Record<string, unknown>): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const body = { id, platform: process.platform, node: process.version, ...result };
  writeFileSync(join(RESULTS_DIR, `${id}.json`), `${JSON.stringify(body, null, 2)}\n`);
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export interface ProcessRun {
  status: number | null;
  output: string;
  wallMs: number;
}

/** Runs `node <args>` in `cwd`; resolves with the exit code, output and wall time. */
export function runNode(
  args: string[],
  cwd: string,
  env: Record<string, string | undefined>,
): Promise<ProcessRun> {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('PW_PERF_')),
  );
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...clean, CI: '', NO_COLOR: '1', ...env },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (status) => {
      resolve({ status, output, wallMs: performance.now() - started });
    });
  });
}

/** A scratch directory (with a space in its path) and the demo server. */
export interface Workspace {
  dir: string;
  server: DemoServer;
  /** POST /__control of the demo server. */
  control(body: unknown): Promise<void>;
  close(): Promise<void>;
}

export async function startWorkspace(): Promise<Workspace> {
  requireBuild();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pw-perf perf-')));
  const server = await startDemoServer();
  return {
    dir,
    server,
    async control(body) {
      const response = await fetch(`${server.url}/__control`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`POST /__control: ${response.status}`);
    },
    async close() {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
