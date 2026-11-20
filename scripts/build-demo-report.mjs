#!/usr/bin/env node
// @ts-check
// Builds the demo HTML report for GitHub Pages (13-REQ-17): a copy of examples/with-setup runs
// through the built CLI against the demo server of this repository (test/demo-server): first
// `thresholds`, then `test` with one endpoint 300 ms slower (S-02), so the report shows a
// blocking violation. The copy turns gate.warnOnly off, so the violation blocks (exit code 2).
// Only data of this repository goes into the report: the demo server listens on the example's
// default ports (3000 and 3001), and the temporary project directory in the run report is
// replaced by examples/with-setup before the HTML is rendered again (`pw-perf report`).
// Writes <out>/index.html.
//
// Usage: node scripts/build-demo-report.mjs --out <dir> [--repeat <n>]
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
 * Builds the demo report into `out` and returns the exit codes of both runs.
 * @param {{ out: string, repeat?: number, log?: (line: string) => void }} options
 */
export async function buildDemoReport({ out, repeat = 10, log = () => {} }) {
  if (!existsSync(join(root, 'dist/cli.js'))) {
    throw new Error('The demo report uses the built package: run "pnpm build" first.');
  }
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'pw-perf-demo-')));
  const server = await startDemoServer(PORTS);
  try {
    const project = join(scratch, 'with-setup');
    cpSync(join(root, 'examples/with-setup'), project, {
      recursive: true,
      filter: (path) => !/[\\/](node_modules|pw-perf-results|test-results|\.auth)$/u.test(path),
    });
    const config = join(project, 'pw-perf.config.ts');
    const source = readFileSync(config, 'utf8');
    if (!source.includes('warnOnly: true')) throw new Error(`${config}: no "warnOnly: true"`);
    writeFileSync(config, source.replace('warnOnly: true', 'warnOnly: false'));
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
    /**
     * @param {string[]} args
     * @returns {Promise<{ status: number | null, output: string }>}
     */
    const run = (args) =>
      new Promise((done, fail) => {
        const command = args[0] ?? '';
        const child = spawn(process.execPath, [join(root, 'dist/cli.js'), ...args], {
          cwd: project,
          env: { ...process.env, CI: '', BASE_URL: server.url, API_URL: server.apiUrl },
        });
        let output = '';
        child.stdout.on('data', (chunk) => (output += String(chunk)));
        child.stderr.on('data', (chunk) => (output += String(chunk)));
        child.on('error', fail);
        child.on('close', (status) => {
          log(`${command}: exit code ${status}`);
          done({ status, output });
        });
      });

    await control({ delays: DELAYS, noise: { seed: 1, sigma: 0.15 } });
    const measure = ['--grep', '@perf', '--repeat', String(repeat)];
    const thresholds = await run(['thresholds', ...measure]);
    if (thresholds.status !== 0) {
      throw new Error(`The thresholds run failed:\n${thresholds.output}`);
    }
    const slow = { ...DELAYS, [SLOW_ENDPOINT]: DELAYS[SLOW_ENDPOINT] + SLOWDOWN_MS };
    await control({ delays: slow, noise: { seed: 2, sigma: 0.15 } });
    const test = await run(['test', ...measure]);
    if (test.status !== 2) {
      throw new Error(`The test run should fail on ${SLOW_ENDPOINT} (exit 2):\n${test.output}`);
    }
    const reportFile = join(project, 'pw-perf-results/report.json');
    const report = JSON.parse(readFileSync(reportFile, 'utf8'));
    report.configDir = 'examples/with-setup';
    writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    mkdirSync(out, { recursive: true });
    const html = join(out, 'index.html');
    const rendered = await run(['report', '--input', reportFile, '--output', html]);
    if (rendered.status !== 0) throw new Error(`pw-perf report failed:\n${rendered.output}`);
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
    console.error('Usage: node scripts/build-demo-report.mjs --out <dir> [--repeat <n>]');
    process.exit(2);
  }
  const repeat = Number(option('--repeat', args) ?? 10);
  try {
    await buildDemoReport({ out: resolve(out), repeat, log: (line) => console.log(line) });
    console.log(`Demo report written to ${join(resolve(out), 'index.html')}.`);
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
