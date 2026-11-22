#!/usr/bin/env node
// @ts-check
// Builds the demo HTML report for GitHub Pages (13-REQ-17): a copy of examples/with-setup runs
// with the built package in the environment mode (PW_PERF_MODE=… playwright test, D-35) against
// the demo server of this repository (test/demo-server): first `thresholds`, then `test` with one
// endpoint 300 ms slower (S-02), so the report shows a blocking violation (exitCode 2 in
// outcome.json).
// Only data of this repository goes into the report: the demo server listens on the example's
// default ports (3000 and 3001), and the temporary project directory in the run report is
// replaced by examples/with-setup before the HTML is rendered again with renderHtmlReport.
// Writes <out>/index.html.
//
// Usage: node scripts/build-demo-report.mjs --out <dir> [--passes <n>]
// Needs `pnpm build` and the Chromium of the installed Playwright.
import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRunReport } from '../src/core/schema/index.ts';
import { renderHtmlReport } from '../src/html/index.ts';
import { startDemoServer } from '../test/demo-server/server.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Endpoints of the example with their median delay in ms. */
const DELAYS = {
  'GET /api/products': 120,
  'GET /api/cart': 80,
  'GET /api/cart/items': 90,
  'GET /api/prices': 60,
};
/** The slowed-down endpoint of the second run and the added delay (S-02). */
export const SLOW_ENDPOINT = 'GET /api/products';
const SLOWDOWN_MS = 300;
/** Ports of the example's playwright.config.ts (BASE_URL and API_URL defaults). */
const PORTS = { port: 3000, apiPort: 3001 };

/**
 * @param {string} name
 * @param {string[]} args
 * @returns {string | undefined}
 */
function option(name, args) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

/**
 * Builds the demo report into `out` and returns the exitCode of both runs (outcome.json).
 * @param {{ out: string, passes?: number, log?: (line: string) => void }} options
 */
export async function buildDemoReport({ out, passes = 10, log = () => {} }) {
  if (!existsSync(join(root, 'dist/reporter.js'))) {
    throw new Error('The demo report uses the built package: run "pnpm build" first.');
  }
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pw-perf-demo-')));
  const server = await startDemoServer(PORTS);
  try {
    const project = join(scratch, 'with-setup');
    cpSync(join(root, 'examples/with-setup'), project, {
      recursive: true,
      filter: (path) => !/[\\/](node_modules|reports|test-results|\.auth)$/u.test(path),
    });
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    mkdirSync(join(project, 'node_modules/@playwright'), { recursive: true });
    symlinkSync(
      join(root, 'node_modules/@playwright/test'),
      join(project, 'node_modules/@playwright/test'),
      type,
    );
    symlinkSync(root, join(project, 'node_modules/playwright-performance-regression'), type);

    /** @param {unknown} body */
    const control = async (body) => {
      const response = await fetch(`${server.url}/__control`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`POST /__control: ${response.status}`);
    };
    // Asynchronous: the demo server runs in this process.
    const playwright = join(root, 'node_modules/@playwright/test/cli.js');
    const outcomeFile = join(project, 'reports/pw-perf/outcome.json');
    /**
     * `PW_PERF_MODE=<mode> playwright test --grep @perf`; status is the exitCode of outcome.json.
     * @param {'test' | 'thresholds'} mode
     * @returns {Promise<{ status: number | null, output: string }>}
     */
    const run = (mode) =>
      new Promise((done, fail) => {
        const child = spawn(process.execPath, [playwright, 'test', '--grep', '@perf'], {
          cwd: project,
          env: {
            ...process.env,
            CI: '',
            BASE_URL: server.url,
            API_URL: server.apiUrl,
            PW_PERF_MODE: mode,
            PW_PERF_PASSES: String(passes),
          },
        });
        let output = '';
        child.stdout.on('data', (chunk) => (output += String(chunk)));
        child.stderr.on('data', (chunk) => (output += String(chunk)));
        child.on('error', fail);
        child.on('close', () => {
          const status = existsSync(outcomeFile)
            ? JSON.parse(readFileSync(outcomeFile, 'utf8')).exitCode
            : null;
          log(`${mode}: exitCode ${status}`);
          done({ status, output });
        });
      });

    await control({ delays: DELAYS, noise: { seed: 1, sigma: 0.15 } });
    const thresholds = await run('thresholds');
    if (thresholds.status !== 0) {
      throw new Error(`The thresholds run failed:\n${thresholds.output}`);
    }
    const slow = { ...DELAYS, [SLOW_ENDPOINT]: DELAYS[SLOW_ENDPOINT] + SLOWDOWN_MS };
    await control({ delays: slow, noise: { seed: 2, sigma: 0.15 } });
    const test = await run('test');
    if (test.status !== 2) {
      throw new Error(`The test run should fail on ${SLOW_ENDPOINT} (exitCode 2):\n${test.output}`);
    }
    const reportFile = join(project, 'reports/pw-perf/report.json');
    const report = JSON.parse(readFileSync(reportFile, 'utf8'));
    report.configDir = 'examples/with-setup';
    const parsed = parseRunReport(JSON.stringify(report), reportFile);
    if (!parsed.ok) throw new Error(`The run report is invalid: ${JSON.stringify(parsed.issues)}`);
    mkdirSync(out, { recursive: true });
    const html = join(out, 'index.html');
    writeFileSync(html, renderHtmlReport(parsed.value));
    const page = readFileSync(html, 'utf8');
    if (page.includes(scratch) || page.includes(tmpdir())) {
      throw new Error(`${html} contains a path of the temporary project`);
    }
    return { thresholds: thresholds.status, test: test.status, output: test.output };
  } finally {
    await server.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const out = option('--out', args);
  if (out === undefined) {
    console.error('Usage: node scripts/build-demo-report.mjs --out <dir> [--passes <n>]');
    process.exit(2);
  }
  const passes = Number(option('--passes', args) ?? 10);
  try {
    await buildDemoReport({ out: resolve(out), passes, log: (line) => console.log(line) });
    console.log(`Demo report written to ${join(resolve(out), 'index.html')}.`);
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
