// Runs real Playwright with Chromium on test/integration/projects/collector against the demo
// server, with the built package (dist/). Needs the Chromium of the installed Playwright:
// `pnpm exec playwright install chromium`.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { parseSampleBatch } from '../../src/core/schema/index.ts';
import {
  CONTEXT_CLOSED_FAILURE_TEXT,
  SAMPLES_ATTACHMENT_NAME,
} from '../../src/core/types/index.ts';
import type { RawRequestSample, SampleBatch } from '../../src/core/types/index.ts';
import { createAjv, validator } from '../contract/schemas.ts';
import { startDemoServer } from '../demo-server/server.ts';
import type { DemoServer } from '../demo-server/server.ts';

const root = join(import.meta.dirname, '../..');
const project = join(import.meta.dirname, 'projects/collector');
const playwrightCli = join(root, 'node_modules/@playwright/test/cli.js');
const RUN_TIMEOUT = 120_000;
const validateBatch = validator(createAjv(), 'samples.schema.json');

interface Result {
  project: string;
  file: string;
  title: string;
  status: string;
  startTime: number;
  duration: number;
  /** Wall clock in the main process when the result arrived: after the whole teardown. */
  endTime: number;
  annotations: { type: string; description?: string }[];
  steps: { title: string; category: string }[];
  errors: string[];
  attachments: { name: string; contentType: string; body: string | null }[];
}

interface Run {
  status: number | null;
  output: string;
  results: Result[];
}

let scratch = '';
let server: DemoServer;
let runs = 0;

beforeAll(async () => {
  if (!existsSync(join(root, 'dist/fixture.js'))) {
    throw new Error('The integration tests use the built package: run "pnpm build" first.');
  }
  scratch = mkdtempSync(join(tmpdir(), 'pw-perf-collector-'));
  server = await startDemoServer();
});

afterAll(async () => {
  await server?.close();
  if (scratch !== '') rmSync(scratch, { recursive: true, force: true });
});

/** Runs Playwright asynchronously: the demo server lives in this process. */
function runPlaywright(env: Record<string, string>, files: string[]): Promise<Run> {
  const out = join(scratch, `run-${++runs}`);
  mkdirSync(out);
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('PW_PERF_')),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [playwrightCli, 'test', ...files], {
      cwd: project,
      env: {
        ...clean,
        CI: '',
        INTEGRATION_OUT: out,
        DEMO_URL: server.url,
        DEMO_API_URL: server.apiUrl,
        ...env,
      },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (status) => {
      const path = join(out, 'results.jsonl');
      const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
      const results = text
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Result);
      resolve({ status, output, results });
    });
  });
}

function result(run: Run, title: string): Result {
  const found = run.results.filter((r) => r.title === title);
  if (found.length !== 1) {
    throw new Error(`expected one result "${title}", got ${found.length}\n${run.output}`);
  }
  return found[0] as Result;
}

function batches(r: Result): SampleBatch[] {
  return r.attachments
    .filter((a) => a.name === SAMPLES_ATTACHMENT_NAME)
    .map((a) => {
      expect(a.contentType).toBe('application/json');
      const parsed = parseSampleBatch(a.body ?? '', r.title);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
      return parsed.value;
    });
}

function batch(run: Run, title: string): SampleBatch {
  const list = batches(result(run, title));
  expect(list, title).toHaveLength(1);
  return list[0] as SampleBatch;
}

function sample(b: SampleBatch, part: string): RawRequestSample {
  const found = b.requests.filter((s) => s.url.includes(part));
  expect(
    found.map((s) => s.url),
    part,
  ).toHaveLength(1);
  return found[0] as RawRequestSample;
}

const paths = (b: SampleBatch): string[] => b.requests.map((s) => new URL(s.url).pathname);

/**
 * Time from the end of the test body to the result reaching the reporter: the teardown plus a
 * few milliseconds of closing the context and messaging, so never less than the teardown.
 */
function teardownMs(r: Result): number {
  const mark = r.annotations.find((a) => a.type === 'body-end');
  if (mark?.description === undefined) throw new Error(`no body-end mark in "${r.title}"`);
  return r.endTime - Number(mark.description);
}

/** The single sample whose URL path is `path`. */
function samplePath(b: SampleBatch, path: string): RawRequestSample {
  const found = b.requests.filter((s) => new URL(s.url).pathname === path);
  expect(
    found.map((s) => s.url),
    path,
  ).toHaveLength(1);
  return found[0] as RawRequestSample;
}

const MAIN_FILES = ['basic.spec.ts', 'worker-context.spec.ts', 'custom-contexts.spec.ts'];

describe('collector in Chromium (perf mode)', () => {
  let run: Run;

  beforeAll(async () => {
    run = await runPlaywright({ PW_PERF_MODE: 'test' }, MAIN_FILES);
  }, RUN_TIMEOUT);

  test('the run passes', () => {
    expect(run.status, run.output).toBe(0);
    expect(result(run, 'timeout during measure').status).toBe('timedOut');
    expect(run.results.length).toBeGreaterThan(15);
  });

  test('05-AC-11 every attachment passes the samples schema', () => {
    const all = run.results.flatMap((r) =>
      r.attachments.filter((a) => a.name === SAMPLES_ATTACHMENT_NAME),
    );
    expect(all.length).toBeGreaterThan(15);
    for (const attachment of all) {
      const json = JSON.parse(attachment.body ?? '') as unknown;
      expect(validateBatch(json), JSON.stringify(validateBatch.errors)).toBe(true);
      expect(parseSampleBatch(attachment.body ?? '', 'attachment').ok).toBe(true);
    }
  });

  test('05-AC-16 the setup project has no attachment, every measured test has one', () => {
    const setup = run.results.filter((r) => r.project === 'setup');
    expect(setup).toHaveLength(1);
    expect(setup[0]?.attachments.filter((a) => a.name === SAMPLES_ATTACHMENT_NAME)).toEqual([]);
    const measured = run.results.filter((r) => r.project === 'chromium');
    for (const r of measured) expect(batches(r), r.title).toHaveLength(1);
    // Login requests of the setup project are in no batch (05-D-09).
    for (const r of measured) expect(JSON.stringify(batches(r))).not.toContain('/api/login');
  });

  test('05-AC-02 a test without page or context creates no browser context', () => {
    const r = result(run, 'no browser');
    const fixtures = r.steps.filter((s) => s.category === 'fixture').map((s) => s.title);
    expect(
      fixtures.some((t) => /\b(context|page)\b/u.test(t)),
      fixtures.join(', '),
    ).toBe(false);
    const b = batch(run, 'no browser');
    expect(b.collector.browserName).toBeNull();
    expect(b.requests).toEqual([]);
    expect(b.custom).toEqual([
      { name: 'compute', outcome: 'ok', duration: expect.any(Number), endTime: expect.any(Number) },
    ]);
  });

  test('05-AC-03 requests from a popup and a second tab are measured', () => {
    const b = batch(run, 'popup and second tab');
    expect(paths(b)).toEqual(
      expect.arrayContaining(['/page', '/popup', '/api/popup', '/tab', '/api/tab']),
    );
    expect(b.collector).toEqual({
      name: 'playwright-js',
      version: expect.any(String),
      browserName: 'chromium',
    });
    const page = sample(b, '/api/popup');
    expect(page).toMatchObject({
      method: 'GET',
      resourceType: 'fetch',
      status: 200,
      timeSource: 'browser',
    });
    expect(page.duration).toBeGreaterThan(0);
  });

  test('05-AC-18 a redirect gives one sample per step with its own status and time', () => {
    const b = batch(run, 'redirect');
    const redirect = samplePath(b, '/api/redirect');
    const target = samplePath(b, '/api/delay');
    expect([redirect.status, target.status]).toEqual([302, 200]);
    expect(redirect.duration).not.toBeNull();
    expect(target.duration).toBeGreaterThanOrEqual(49);
  });

  test('05-AC-17 a response generated by a service worker is flagged', () => {
    const b = batch(run, 'service worker');
    const fromWorker = sample(b, '/api/sw-cached');
    expect(fromWorker).toMatchObject({ status: 200, fromServiceWorker: true });
    // The worker script itself is filtered (.js) and no request is counted twice.
    expect(b.requests.filter((s) => s.url.includes('/api/sw-cached'))).toHaveLength(1);
  });

  test('errors, aborts and filters (05-REQ-11, 05, chapter 5.2)', () => {
    const b = batch(run, 'errors and aborts');
    expect(sample(b, 'k=aborted')).toMatchObject({
      status: 'FAILED',
      failureText: 'net::ERR_FAILED',
      duration: null,
    });
    expect(sample(b, '/api/drop')).toMatchObject({ status: 'FAILED' });
    expect(sample(b, '/api/status?code=500').status).toBe(500);
    expect(sample(b, '/api/data.json').status).toBe(200);
    expect(b.requests.some((s) => s.url.includes('/static/app.js'))).toBe(false);
  });

  test('a CORS preflight is inside duration, not in requestStart (05-REQ-26)', () => {
    const preflighted = sample(batch(run, 'cors preflight'), 'k=preflight');
    expect(preflighted.status).toBe(200);
    // The server answers the preflight after 300 ms and the request after 100 ms.
    expect(preflighted.duration).toBeGreaterThanOrEqual(395);
    expect(preflighted.requestStart).toBeLessThan(300);
    expect(preflighted.ttfb).toBeLessThan(300);
  });

  test('05-AC-21 a response whose body the page does not read keeps its status without a duration', () => {
    const r = result(run, 'unread body');
    const unread = sample(batch(run, 'unread body'), 'k=unread');
    expect(unread).toMatchObject({ status: 200, duration: null, timeSource: 'browser' });
    // It is counted as a status but not timed; the collector waited for it.
    expect(teardownMs(r)).toBeGreaterThanOrEqual(1900);
  });

  test('05-AC-20 closing a page or a context fails its requests at once, without waiting', () => {
    for (const [title, k] of [
      ['closed page', 'k=page-close'],
      ['closed context', 'k=context-close'],
    ] as const) {
      const r = result(run, title);
      expect(sample(batch(run, title), k), title).toMatchObject({
        status: 'FAILED',
        failureText: CONTEXT_CLOSED_FAILURE_TEXT,
        duration: null,
      });
      expect(teardownMs(r), title).toBeLessThan(1000);
    }
  });

  test('05-AC-08 a tracked own context is measured, an untracked one is not', () => {
    const b = batch(run, 'tracked and untracked contexts');
    expect(sample(b, 'k=tracked').status).toBe(200);
    expect(b.requests.some((s) => s.url.includes('k=untracked'))).toBe(false);
  });

  test('05-AC-22 a role fixture closing its context does not spend the wait budget', () => {
    const r = result(run, 'role fixture closes its context');
    expect(sample(batch(run, r.title), 'k=role-close')).toMatchObject({
      status: 'FAILED',
      failureText: CONTEXT_CLOSED_FAILURE_TEXT,
    });
    expect(teardownMs(r)).toBeLessThan(1000);
  });

  test('05-AC-15 wrapping twice gives as many samples as wrapping once', () => {
    const counts = ['single wrap', 'twice wrapped', 'derived and wrapped again'].map((title) =>
      batch(run, title).requests.map((s) => new URL(s.url).pathname + new URL(s.url).search),
    );
    expect(counts[0]).toEqual(['/page', '/api/delay?ms=0&k=wrap']);
    expect(counts[1]).toEqual(counts[0]);
    expect(counts[2]).toEqual(counts[0]);
  });

  test('05-AC-14 05-AC-19 a worker context tracked with trackContext() gives samples in each test', () => {
    const first = batch(run, 'worker context first');
    const second = batch(run, 'worker context second');
    expect(sample(first, 'k=first').status).toBe(200);
    // Started in the first test and still in flight after its wait.
    expect(sample(first, 'k=straddle').status).toBe('PENDING');
    expect(sample(second, 'k=second').status).toBe(200);
    // Finished during the second test, which did not see it start (05-REQ-25).
    expect(second.requests.some((s) => s.url.includes('k=straddle'))).toBe(false);
    expect([first.collector.browserName, second.collector.browserName]).toEqual([
      'chromium',
      'chromium',
    ]);
  });

  test('05-AC-09 a late context override and a page on its own context are tracked by the page override', () => {
    for (const [title, k] of [
      ['context overridden after withPerfFixtures', 'k=late-context'],
      ['page on its own context', 'k=own-page'],
    ] as const) {
      const b = batch(run, title);
      expect(sample(b, k).status, title).toBe(200);
      expect(
        b.diagnostics.map((d) => d.code),
        title,
      ).toEqual(['COLLECTOR_CONTEXT_AUTO_TRACKED']);
    }
    // The fixture context itself needs no auto-tracking.
    expect(batch(run, 'single wrap').diagnostics).toEqual([]);
  });

  test('custom measurements in the test, in beforeEach and at a timeout (06, chapter 11)', () => {
    const b = batch(run, 'measure, start and end');
    expect(b.custom.map((s) => [s.name, s.outcome])).toEqual([
      ['hook:before-each', 'ok'],
      ['demo:load', 'ok'],
      ['demo:call', 'ok'],
      ['demo:alias', 'ok'],
      ['demo:error', 'error'],
    ]);
    const call = b.custom.find((s) => s.name === 'demo:call');
    expect(call?.duration).toBeGreaterThanOrEqual(100);
    const timedOut = result(run, 'timeout during measure');
    expect(timedOut.status).toBe('timedOut');
    const t = batch(run, 'timeout during measure');
    expect(t.custom.map((s) => [s.name, s.outcome])).toEqual([
      ['hook:before-each', 'ok'],
      ['demo:slow', 'unfinished'],
    ]);
    expect(t.diagnostics).toEqual([
      expect.objectContaining({ code: 'CUSTOM_UNFINISHED', count: 1 }),
    ]);
  });
});

describe('collector in Chromium: requests in flight at test end', () => {
  test(
    '05-AC-06 pendingTimeoutMs 500 gives PENDING after about 500 ms',
    async () => {
      const run = await runPlaywright({ PW_PERF_MODE: 'test', PENDING_TIMEOUT_MS: '500' }, [
        'in-flight.spec.ts',
      ]);
      expect(run.status, run.output).toBe(0);
      const r = result(run, 'request in flight at test end');
      expect(sample(batch(run, r.title), 'k=in-flight')).toMatchObject({
        status: 'PENDING',
        duration: null,
        requestStart: null,
        ttfb: null,
        fromServiceWorker: false,
      });
      expect(teardownMs(r)).toBeGreaterThanOrEqual(450);
      expect(teardownMs(r)).toBeLessThan(1300);
    },
    RUN_TIMEOUT,
  );

  describe('pendingTimeoutMs 5000', () => {
    let run: Run;

    beforeAll(async () => {
      run = await runPlaywright({ PW_PERF_MODE: 'test', PENDING_TIMEOUT_MS: '5000' }, [
        'in-flight.spec.ts',
        'wait-budget.spec.ts',
      ]);
    }, RUN_TIMEOUT);

    test('05-AC-06 pendingTimeoutMs 5000 waits for the request: status 200 and about 3000 ms', () => {
      expect(run.status, run.output).toBe(0);
      const done = sample(batch(run, 'request in flight at test end'), 'k=in-flight');
      expect(done).toMatchObject({ status: 200, timeSource: 'browser' });
      // The demo server answers after exactly 3000 ms.
      expect(done.duration).toBeGreaterThanOrEqual(2995);
      expect(done.duration).toBeLessThan(3600);
    });

    test('05-AC-12 the wait stays inside the teardown slot, also with a 500 ms afterEach', () => {
      for (const [title, k] of [
        ['budget without hooks', 'k=budget'],
        ['budget with afterEach', 'k=budget-hook'],
      ] as const) {
        const r = result(run, title);
        expect(r.status, `${title}\n${run.output}`).toBe('passed');
        expect(sample(batch(run, title), k).status, title).toBe('PENDING');
      }
      // Budget = 2000 - time since the teardown started - 1000: about 1000 ms.
      const plain = teardownMs(result(run, 'budget without hooks'));
      expect(plain).toBeGreaterThanOrEqual(900);
      expect(plain).toBeLessThan(1700);
      // The afterEach hook runs before the collector's teardown: 500 ms more.
      const hooked = teardownMs(result(run, 'budget with afterEach'));
      expect(hooked).toBeGreaterThanOrEqual(1400);
      expect(hooked).toBeLessThan(2200);
    });
  });
});

describe('collector in Chromium: perf mode off', () => {
  test(
    '05-AC-01 06-AC-04 without perf mode the tests behave the same and have no attachment',
    async () => {
      const run = await runPlaywright({}, MAIN_FILES);
      expect(run.status, run.output).toBe(0);
      expect(run.results.length).toBeGreaterThan(15);
      for (const r of run.results) {
        expect(
          r.attachments.filter((a) => a.name === SAMPLES_ATTACHMENT_NAME),
          r.title,
        ).toEqual([]);
        expect(r.status, r.title).toBe(
          r.title === 'timeout during measure' ? 'timedOut' : 'passed',
        );
      }
      // perf.measure ran its function and perf.end returned a duration (asserted in the test).
      expect(result(run, 'measure, start and end').status).toBe('passed');
      expect(result(run, 'no browser').status).toBe('passed');
    },
    RUN_TIMEOUT,
  );
});
