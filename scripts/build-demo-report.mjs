#!/usr/bin/env node
// @ts-check
// Builds the demo pages for GitHub Pages (13-REQ-17, 13-REQ-29): a copy of examples/with-setup
// runs with the built package in the environment mode (PW_PERF_MODE=… playwright test, D-35)
// against the demo server of this repository (test/demo-server): first `thresholds`, then two
// `test` runs evaluated with those thresholds:
// - slow-endpoint.html: one endpoint 300 ms slower (S-02), a blocking time violation;
// - fast-failure.html: one endpoint answers 401 in a few ms and the shop page stops loading the
//   cart, so the nonSuccess rule fails and the cart shows a workload shift (D-55).
// The first call of one endpoint is slower in every run (a cold start, measure.coldSamples).
// Both runs end with exitCode 2 in outcome.json. index.html links the two reports.
// Only data of this repository goes into the reports: the demo server listens on the example's
// default ports (3000 and 3001), and the temporary project directory in the run report is
// replaced by examples/with-setup before the HTML is rendered again with renderHtmlReport.
//
// --docs also runs the fast-failure case with checks.nonSuccess.enabled: false (what 1.0.x did)
// and writes the material of docs/thresholds.md#fast-failures-and-workload-changes (13-REQ-28):
// the golden console cases test/golden/console/fast-failure*.json (then run
// `GOLDEN_UPDATE=1 pnpm vitest run test/unit/console`) and the screenshots in docs/img/.
//
// Usage: node scripts/build-demo-report.mjs --out <dir> [--passes <n>] [--docs]
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
import { fileURLToPath, pathToFileURL } from 'node:url';
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
/** Fast-failure run (13-REQ-29): the endpoint answers 401 after a few ms... */
export const FAILING_ENDPOINT = 'GET /api/products';
const FAILING_STATUS = 401;
const FAILING_MS = 8;
/** ...and the shop page stops loading the cart (a workload shift of GET /api/cart). */
const SKIPPED_CALL = '/api/cart';
/** Every run: the first call of this endpoint is slower (a cold start, 13-REQ-28 item 5). */
const COLD = { 'GET /api/prices': 400 };
/** Its key in the report: the API origin has the label "api" in the example's config. */
const COLD_KEY = 'GET api/api/prices';
/** The pages of the demo (13-REQ-29). */
export const DEMO_PAGES = ['index.html', 'slow-endpoint.html', 'fast-failure.html'];
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

/** @param {string} text */
const escapeHtml = (text) =>
  text.replace(
    /[&<>"]/gu,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
  );

/**
 * The landing page of the demo: one link and one sentence per report (13-REQ-29).
 * @param {string} version
 */
export function demoIndex(version) {
  const item = (
    /** @type {string} */ href,
    /** @type {string} */ title,
    /** @type {string} */ text,
  ) => `<li><a href="${href}">${escapeHtml(title)}</a><p>${escapeHtml(text)}</p></li>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>playwright-performance-regression demo</title>
<style>
:root { color-scheme: light dark; --fg: #1f2328; --bg: #ffffff; --muted: #59636e; --link: #0969da; }
@media (prefers-color-scheme: dark) { :root { --fg: #e6edf3; --bg: #0d1117; --muted: #9198a1; --link: #4493f8; } }
body { margin: 0 auto; max-width: 42rem; padding: 2rem 1rem; font: 16px/1.5 system-ui, sans-serif; color: var(--fg); background: var(--bg); }
a { color: var(--link); font-weight: 600; }
p { margin: 0.25rem 0 0; color: var(--muted); }
ul { padding: 0; list-style: none; }
li { margin: 1.5rem 0; }
</style>
</head>
<body>
<h1>playwright-performance-regression demo</h1>
<p>HTML reports of <code>examples/with-setup</code> measured against the demo server of the repository, version ${escapeHtml(version)}.</p>
<ul>
${item('slow-endpoint.html', 'Slow endpoint', 'One endpoint got 300 ms slower than in the thresholds run: the time rules block the run.')}
${item('fast-failure.html', 'Fast failure', 'One endpoint answers 401 in a few milliseconds instead of 200 in 120 ms: it looks faster, the time rules cannot see it, and the nonSuccess rule blocks the run.')}
</ul>
<p><a href="https://github.com/Meser6/playwright-performance-regression">Source and documentation</a></p>
</body>
</html>
`;
}

/**
 * Builds the demo pages into `out` and returns the exitCode of the runs (outcome.json). With
 * `docs`, also writes the golden console cases and screenshots of the fast-failure section.
 * @param {{ out: string, passes?: number, docs?: boolean, log?: (line: string) => void }} options
 */
export async function buildDemoReport({ out, passes = 10, docs = false, log = () => {} }) {
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
     * @param {string} name
     * @returns {Promise<{ status: number | null, output: string }>}
     */
    const run = (mode, name = mode) =>
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
          log(`${name}: exitCode ${status}`);
          done({ status, output });
        });
      });

    const reportFile = join(project, 'reports/pw-perf/report.json');
    /** The run report with the project directory of the repository instead of the temporary one. */
    const runReport = () => {
      const report = JSON.parse(readFileSync(reportFile, 'utf8'));
      report.configDir = 'examples/with-setup';
      const parsed = parseRunReport(JSON.stringify(report), reportFile);
      if (!parsed.ok) {
        throw new Error(`The run report is invalid: ${JSON.stringify(parsed.issues)}`);
      }
      return parsed.value;
    };
    mkdirSync(out, { recursive: true });
    /**
     * @param {string} name
     * @param {import('../src/core/types/index.ts').RunReport} report
     */
    const writePage = (name, report) => {
      const file = join(out, name);
      writeFileSync(file, renderHtmlReport(report));
      const page = readFileSync(file, 'utf8');
      if (page.includes(scratch) || page.includes(tmpdir())) {
        throw new Error(`${file} contains a path of the temporary project`);
      }
      return file;
    };

    await control({ delays: DELAYS, noise: { seed: 1, sigma: 0.15 }, cold: COLD });
    const thresholds = await run('thresholds');
    if (thresholds.status !== 0) {
      throw new Error(`The thresholds run failed:\n${thresholds.output}`);
    }

    const slow = { ...DELAYS, [SLOW_ENDPOINT]: DELAYS[SLOW_ENDPOINT] + SLOWDOWN_MS };
    await control({ delays: slow, noise: { seed: 2, sigma: 0.15 }, cold: COLD });
    const test = await run('test', 'slow-endpoint');
    if (test.status !== 2) {
      throw new Error(`The test run should fail on ${SLOW_ENDPOINT} (exitCode 2):\n${test.output}`);
    }
    writePage('slow-endpoint.html', runReport());

    const failing = {
      delays: { ...DELAYS, [FAILING_ENDPOINT]: FAILING_MS },
      noise: { seed: 3, sigma: 0.15 },
      statuses: { [FAILING_ENDPOINT]: FAILING_STATUS },
      appSkip: [SKIPPED_CALL],
      cold: COLD,
    };
    await control(failing);
    const fast = await run('test', 'fast-failure');
    const fastReport = runReport();
    const nonSuccess = fastReport.endpoints[FAILING_ENDPOINT]?.evaluation.checks.find(
      (c) => c.rule === 'nonSuccess',
    );
    if (fast.status !== 2 || nonSuccess?.passed !== false) {
      throw new Error(
        `The fast-failure run should fail on ${FAILING_ENDPOINT} by the nonSuccess rule (exitCode 2):\n${fast.output}`,
      );
    }
    const fastPage = writePage('fast-failure.html', fastReport);
    writeFileSync(join(out, 'index.html'), demoIndex(fastReport.tool.version));

    /** @type {number | null} */
    let ruleOff = null;
    if (docs) {
      /** @param {string} name @param {import('../src/core/types/index.ts').RunReport} report */
      const golden = (name, report) =>
        writeFileSync(
          join(root, 'test/golden/console', `${name}.json`),
          `${JSON.stringify({ name: `${name}: the fast-failure demo run (13-REQ-28, generated by scripts/build-demo-report.mjs --docs)`, input: report }, null, 2)}\n`,
        );
      golden('fast-failure', fastReport);
      // The same case without the nonSuccess rule: the gate of 1.0.x.
      const configFile = join(project, 'pw-perf.config.ts');
      writeFileSync(
        configFile,
        readFileSync(configFile, 'utf8').replace(
          "  thresholds: { preset: 'normal' },",
          "  thresholds: { preset: 'normal' },\n  checks: { nonSuccess: { enabled: false } },",
        ),
      );
      await control(failing);
      const off = await run('test', 'fast-failure, nonSuccess off');
      ruleOff = off.status;
      if (off.status !== 0) {
        throw new Error(`The run without the nonSuccess rule should pass:\n${off.output}`);
      }
      const offReport = runReport();
      golden('fast-failure-rule-off', offReport);
      const offPage = writePage('fast-failure-rule-off.html', offReport);
      await screenshots({ fastPage, offPage, dir: join(root, 'docs/img') });
      rmSync(offPage);
    }
    return {
      thresholds: thresholds.status,
      test: test.status,
      fastFailure: fast.status,
      ruleOff,
      output: test.output,
    };
  } finally {
    await server.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Screenshots of the report parts shown in docs/thresholds.md (13-REQ-28), light theme.
 * @param {{ fastPage: string, offPage: string, dir: string }} options
 */
async function screenshots({ fastPage, offPage, dir }) {
  const { chromium } = await import('@playwright/test');
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: 'light',
    });
    /** @param {string} file @param {string} hash */
    const open = async (file, hash) => {
      await page.goto(`${pathToFileURL(file).href}${hash}`);
      await page.waitForLoadState('load');
    };
    /** @param {string} key */
    const keyHash = (key) => `#key=api:${encodeURIComponent(key)}`;
    /** One part of the open key dialog by its heading. @param {string} title */
    const part = (title) =>
      page.locator('#key-dialog .ds').filter({ has: page.locator('h4', { hasText: title }) });

    await open(offPage, '#tab=endpoints');
    await page
      .locator('table.keys > tbody')
      .filter({ has: page.locator('.fk', { hasText: FAILING_ENDPOINT }) })
      .locator('tr')
      .first()
      .screenshot({ path: join(dir, 'fast-failure-rule-off.png') });
    await open(fastPage, keyHash(FAILING_ENDPOINT));
    await part('Checks').screenshot({ path: join(dir, 'fast-failure-checks.png') });
    await part('Unsuccessful responses').screenshot({
      path: join(dir, 'fast-failure-unsuccessful.png'),
    });
    await open(fastPage, keyHash('GET /api/cart'));
    await part('Compared with the thresholds run').screenshot({
      path: join(dir, 'fast-failure-workload.png'),
    });
    await open(fastPage, keyHash(COLD_KEY));
    await part('Cold vs warm').screenshot({ path: join(dir, 'fast-failure-cold.png') });
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const out = option('--out', args);
  if (out === undefined) {
    console.error('Usage: node scripts/build-demo-report.mjs --out <dir> [--passes <n>] [--docs]');
    process.exit(2);
  }
  const passes = Number(option('--passes', args) ?? 10);
  try {
    const docs = args.includes('--docs');
    await buildDemoReport({ out: resolve(out), passes, docs, log: (line) => console.log(line) });
    console.log(`Demo pages written to ${resolve(out)}: ${DEMO_PAGES.join(', ')}.`);
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
