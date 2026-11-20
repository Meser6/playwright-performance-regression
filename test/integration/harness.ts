// Shared harness for the adoption integration projects (12, chapter 6): each project is copied
// to a temporary directory whose path has a space, with the built package, @playwright/test and
// playwright-bdd linked into its node_modules, so the projects import the package by its name
// as a user project does. Playwright runs with Chromium against the demo server (BASE_URL,
// API_URL). Needs `pnpm build` and the Chromium of the installed Playwright.
import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { parseOutcome, parseRunReport } from '../../src/core/schema/index.ts';
import { SAMPLES_ATTACHMENT_NAME } from '../../src/core/types/index.ts';
import type { Outcome, RunReport } from '../../src/core/types/index.ts';
import { createAjv, validator } from '../contract/schemas.ts';
import { startDemoServer } from '../demo-server/server.ts';
import type { DemoServer } from '../demo-server/server.ts';

export const ROOT = join(import.meta.dirname, '../..');
const PROJECTS = join(import.meta.dirname, 'projects');
const RUNNER = join(ROOT, 'node_modules/@playwright/test/cli.js');
const CLI = join(ROOT, 'dist/cli.js');
const LINKED = ['@playwright/test', 'playwright-bdd'];
export const RUN_TIMEOUT = 180_000;

const ajv = createAjv();
const validReport = validator(ajv, 'run-report.schema.json');
const validOutcome = validator(ajv, 'outcome.schema.json');

/** One test result from Playwright's JSON reporter. */
export interface JsonResult {
  project: string;
  title: string;
  status: string;
  duration: number;
  /** Names of the attachments. */
  attachments: string[];
}

export interface ProjectRun {
  status: number | null;
  output: string;
  /** Wall time of the whole Playwright run in ms. */
  wallMs: number;
  /** pw-perf-results/report.json; null when none was written. */
  report: RunReport | null;
  outcome: Outcome | null;
  /** results.json of the JSON reporter, when the project config writes it. */
  results: JsonResult[];
}

export interface Harness {
  server: DemoServer;
  /**
   * Copies `name` from `test/integration/projects` (or the directory `from`) and links the
   * dependencies; returns the copy's directory.
   */
  copy(name: string, from?: string): string;
  run(dir: string, options?: RunOptions): Promise<ProjectRun>;
  close(): Promise<void>;
}

export interface RunOptions {
  env?: Record<string, string>;
  args?: string[];
  /** Run `pw-perf <args>` (the built CLI) instead of `playwright test <args>`. */
  cli?: boolean;
}

export async function startHarness(): Promise<Harness> {
  if (!existsSync(join(ROOT, 'dist/fixture.js'))) {
    throw new Error('The integration tests use the built package: run "pnpm build" first.');
  }
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pw-perf-projects-')));
  const server = await startDemoServer();
  let runs = 0;
  return {
    server,
    copy(name, from = PROJECTS) {
      const dir = join(scratch, `${name} copy`);
      cpSync(join(from, name), dir, {
        recursive: true,
        filter: (path) => !/[\\/](node_modules|pw-perf-results|test-results|\.auth)$/u.test(path),
      });
      const type = process.platform === 'win32' ? 'junction' : 'dir';
      mkdirSync(join(dir, 'node_modules/@playwright'), { recursive: true });
      for (const dep of LINKED) {
        symlinkSync(join(ROOT, 'node_modules', dep), join(dir, 'node_modules', dep), type);
      }
      symlinkSync(ROOT, join(dir, 'node_modules/playwright-performance-regression'), type);
      return dir;
    },
    run: (dir, options = {}) => runProject(dir, server, `run-${++runs}`, options),
    async close() {
      await server.close();
      rmSync(scratch, { recursive: true, force: true });
    },
  };
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

interface JsonSuite {
  title: string;
  suites?: JsonSuite[];
  specs?: {
    title: string;
    tests: {
      projectName: string;
      results: { status: string; duration: number; attachments: { name: string }[] }[];
    }[];
  }[];
}

function readResults(path: string): JsonResult[] {
  if (!existsSync(path)) return [];
  const report = JSON.parse(readFileSync(path, 'utf8')) as { suites: JsonSuite[] };
  const results: JsonResult[] = [];
  const walk = (suite: JsonSuite): void => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests) {
        for (const r of t.results) {
          results.push({
            project: t.projectName,
            title: spec.title,
            status: r.status,
            duration: r.duration,
            attachments: r.attachments.map((a) => a.name),
          });
        }
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites) walk(suite);
  return results;
}

/** Runs `playwright test` in `dir` asynchronously (the demo server lives in this process). */
function runProject(
  dir: string,
  server: DemoServer,
  runId: string,
  options: RunOptions,
): Promise<ProjectRun> {
  for (const old of ['pw-perf-results', 'test-results', 'results.json', 'outcome.json']) {
    rmSync(join(dir, old), { recursive: true, force: true });
  }
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('PW_PERF_')),
  );
  const perf = options.env?.PW_PERF_MODE !== undefined;
  const outcomeFile = join(dir, 'outcome.json');
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const command = options.cli === true ? [CLI] : [RUNNER, 'test'];
    const child = spawn(process.execPath, [...command, ...(options.args ?? [])], {
      cwd: dir,
      env: {
        ...clean,
        CI: '',
        NO_COLOR: '1',
        BASE_URL: server.url,
        API_URL: server.apiUrl,
        ...(perf ? { PW_PERF_RUN_ID: runId, PW_PERF_OUTCOME_FILE: outcomeFile } : {}),
        ...options.env,
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
          wallMs: performance.now() - started,
          report: readReport(join(dir, 'pw-perf-results', 'report.json')),
          outcome: readOutcome(outcomeFile),
          results: readResults(join(dir, 'results.json')),
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

/** Runs playwright-bdd's bddgen in `dir`: generates the test files of the feature files. */
export function bddgen(dir: string): void {
  const result = spawnSync(
    process.execPath,
    [join(ROOT, 'node_modules/playwright-bdd/dist/cli/index.js')],
    { cwd: dir, encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(`bddgen failed:\n${result.stdout}${result.stderr}`);
}

/** Endpoint keys of the report, sorted. */
export const endpointKeys = (run: ProjectRun): string[] =>
  Object.keys(run.report?.endpoints ?? {}).sort();

/** Number of samples of `key`; 0 when the key is missing. */
export const sampleCount = (run: ProjectRun, key: string): number =>
  run.report?.endpoints[key]?.count ?? 0;

/** Codes of the report's warnings. */
export const warningCodes = (run: ProjectRun): string[] =>
  (run.report?.warnings ?? []).map((w) => w.code);

export const hasSamples = (r: JsonResult): boolean =>
  r.attachments.includes(SAMPLES_ATTACHMENT_NAME);

/** Fails with the Playwright output when the run did not end with `status`. */
export function expectStatus(run: ProjectRun, status: number): void {
  expect(run.status, run.output).toBe(status);
}
