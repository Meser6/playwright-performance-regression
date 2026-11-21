import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { parseOutcome, parseRunReport } from '../../../src/core/schema/index.ts';
import type { Outcome, RunReport } from '../../../src/core/types/index.ts';
import { generateRunId } from '../../../src/mode/index.ts';
import { stripAnsi } from '../../../src/console/color.ts';
import { renderHtmlReport } from '../../../src/html/index.ts';
import { runSettings } from '../../../src/reporter/session.ts';
import { createAjv, validator } from '../../contract/schemas.ts';
import {
  batch,
  fakeConfig,
  fakeHost,
  fakeTest,
  project,
  registered,
  request,
  result,
  runTests,
  session,
  tempDir,
} from './harness.ts';

const slash = (path: string): string => path.replace(/\\/gu, '/');
const ajv = createAjv();
const validReport = validator(ajv, 'run-report.schema.json');
const validOutcome = validator(ajv, 'outcome.schema.json');

let dir: string;
beforeEach(() => {
  dir = tempDir();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const ROOT = { allTests: () => [] };
const PATHS = ['/api/items/1', '/api/cart'];
const steady = (i: number, path: string): number => (path === '/api/cart' ? 100 : 50) + (i % 7);

function readReport(): RunReport {
  const text = readFileSync(join(dir, 'pw-perf-results', 'report.json'), 'utf8');
  expect(validReport(JSON.parse(text)), JSON.stringify(validReport.errors)).toBe(true);
  const parsed = parseRunReport(text, 'report.json');
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
}

function readOutcome(file: string): Outcome {
  const text = readFileSync(file, 'utf8');
  expect(validOutcome(JSON.parse(text)), JSON.stringify(validOutcome.errors)).toBe(true);
  const parsed = parseOutcome(text, file);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
}

const codes = (issues: { code: string }[]): string[] => issues.map((i) => i.code);

describe('reporter session in test mode', () => {
  test('writes report.json, the outcome file and the summary without thresholds files', async () => {
    const outcomeFile = join(dir, 'tmp', 'run.outcome.json');
    const captured = fakeHost(dir);
    const s = session(captured, registered({}, { mode: 'test', runId: 'run-1', outcomeFile }));
    s.begin(fakeConfig(dir), ROOT);
    runTests(s, dir, 20, PATHS, steady);
    expect(await s.end({ status: 'passed' })).toBeUndefined();

    const report = readReport();
    expect(report.runId).toBe('run-1');
    expect(report.configDir).toBe(dir);
    expect(report.tests).toEqual({
      status: 'passed',
      expected: 20,
      unexpected: 0,
      flaky: 0,
      skipped: 0,
    });
    expect(Object.keys(report.endpoints).sort()).toEqual(['GET /api/cart', 'GET /api/items/:id']);
    expect(report.endpoints['GET /api/cart']?.slowest[0]?.test).toEqual({
      title: 'cart › adds an item',
      project: 'chromium',
      file: 'tests/cart.spec.ts',
      line: 7,
      repeatEachIndex: 1,
    });
    expect(report.runConditions.projects).toEqual([
      { name: 'chromium', role: 'measured', browserName: 'chromium', repeatEach: 1, retries: 0 },
    ]);
    expect(report.runConditions.overriddenSettings).toEqual(['trace']);
    // Only the endpoint thresholds file is looked for (09-D-17, D-32).
    expect(codes(report.warnings)).toEqual(['THRESHOLDS_FILE_MISSING']);
    expect(report.toolErrors).toEqual([]);

    const outcome = readOutcome(outcomeFile);
    expect(outcome).toMatchObject({ runId: 'run-1', mode: 'test', exitCode: 0 });
    expect(outcome.paths).toEqual({
      reportJson: join(dir, 'pw-perf-results', 'report.json'),
      reportHtml: join(dir, 'pw-perf-results', 'report.html'),
      thresholds: [],
      thresholdsDiff: null,
    });

    const out = captured.stdout.join('');
    expect(out).toContain(
      'playwright-performance-regression: perf mode overrides trace; removed projects firefox; reporter list replaced with dot.\n',
    );
    expect(out).toContain('PASSED');
    // One absolute Report path (09-REQ-30).
    expect(out).toContain(`Report: ${slash(dir)}/pw-perf-results/report.html\n`);
    expect(out).not.toContain('\u001b[');
  });

  test('08-REQ-36 each result is closed after its batches: executions, offsets from TestResult.startTime', async () => {
    const s = session(fakeHost(dir), registered({}, { mode: 'test', runId: 'run-1' }));
    s.begin(fakeConfig(dir), ROOT);
    const start = Date.UTC(2026, 10, 18, 10, 0, 0, 0);
    for (let r = 0; r < 3; r++) {
      const test = fakeTest(dir, { repeatEachIndex: r });
      s.testBegin();
      // The third run has an empty batch; it still counts as an execution.
      const requests =
        r === 2
          ? []
          : [
              request('/api/cart', 100 + r, { startTime: start + 250 }),
              request('/api/items/1', 40, { startTime: start + 120 }),
            ];
      s.testEnd(test, result([batch(requests)], { startTime: new Date(start + 100 * r) }));
    }
    await s.end({ status: 'passed' });
    const breakdown = readReport().testBreakdown;
    expect(breakdown?.tests).toEqual([
      {
        title: 'cart › adds an item',
        project: 'chromium',
        file: 'tests/cart.spec.ts',
        line: 7,
        executions: 3,
        requestCount: 4,
        errorCount: 0,
        totalMs: 281,
        maxRequestMs: 101,
        keyCount: 2,
        topKeys: [
          { key: 'GET /api/cart', count: 2, totalMs: 201 },
          { key: 'GET /api/items/:id', count: 2, totalMs: 80 },
        ],
        violatedKeys: [],
        violatedKeyCount: 0,
      },
    ]);
    // The slowest run (repeat 1) started 100 ms after the first one.
    expect(breakdown?.waterfalls.map((w) => [w.test.repeatEachIndex, w.requests])).toEqual([
      [
        1,
        [
          { offset: 20, duration: 40, key: 'GET /api/items/:id', status: '200' },
          { offset: 150, duration: 101, key: 'GET /api/cart', status: '200' },
        ],
      ],
    ]);
  });

  test('04-AC-44 onBegin prints the start banner with tests × passes, estimate and report path', () => {
    const captured = fakeHost(dir, { env: { NO_COLOR: '1' } });
    const s = session(captured, registered({ run: { passes: { test: 5 } } }, { mode: 'test' }));
    const tests = [0, 1].map(() => fakeTest(dir));
    const setup = fakeTest(dir, { project: 'setup' });
    s.begin(fakeConfig(dir, { projects: [project('setup'), project('chromium')] }), {
      allTests: () => [setup, ...tests],
    });
    const out = captured.stdout.join('');
    expect(out).toContain('⏱️  pw-perf · measurement run');
    expect(out).toContain('Projects  chromium (setup: setup)');
    expect(out).toContain('Tests     2 tests × 5 passes = 10 test runs');
    expect(out).toContain('Estimate  ≈ 5 min (30 s per test, no earlier run)');
    expect(out).toContain('Report    pw-perf-results/report.html');
    expect(out).toContain('Tip       measure a subset, e.g. --grep @perf');
    expect(out).toMatch(/^╭─+╮$/mu);
    // Not a terminal: no question.
    expect(captured.questions).toEqual([]);
  });

  test('01-REQ-40 a run without started tests (--list) writes nothing and keeps the status', async () => {
    const outcomeFile = join(dir, 'run.outcome.json');
    const captured = fakeHost(dir);
    const s = session(captured, registered({}, { mode: 'test', outcomeFile }));
    s.begin(fakeConfig(dir), ROOT);
    const printed = captured.stdout.length;
    expect(await s.end({ status: 'passed' })).toBeUndefined();
    expect(existsSync(join(dir, 'pw-perf-results'))).toBe(false);
    expect(existsSync(outcomeFile)).toBe(false);
    expect(captured.stdout).toHaveLength(printed);
  });

  test('02-AC-05 two reports from the same samples differ only in run id and times', async () => {
    const reports: RunReport[] = [];
    for (const start of [Date.UTC(2026, 10, 18, 10), Date.UTC(2026, 10, 18, 12)]) {
      const captured = fakeHost(dir, { start, random: start % 7 === 0 ? 0.1 : 0.9 });
      const s = session(captured, registered({}, { mode: 'test' }));
      s.begin(fakeConfig(dir), ROOT);
      runTests(s, dir, 25, PATHS, steady);
      await s.end({ status: 'passed' });
      reports.push(readReport());
    }
    const [a, b] = reports as [RunReport, RunReport];
    expect(a.runId).not.toBe(b.runId);
    const strip = (r: RunReport): Partial<RunReport> => {
      const { runId: _r, startedAt: _s, finishedAt: _f, ...rest } = r;
      return rest;
    };
    expect(strip(a)).toEqual(strip(b));
  });

  test('a blocking violation gives exit code 2 and status failed', async () => {
    writeFileSync(
      join(dir, 'pw-perf-thresholds.json'),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'api',
        generated: null,
        entries: { 'GET /api/cart': { median: 10, percentile: 20, p99: 30 } },
      }),
    );
    const outcomeFile = join(dir, 'run.outcome.json');
    const captured = fakeHost(dir);
    const s = session(captured, registered({}, { mode: 'test', outcomeFile }));
    s.begin(fakeConfig(dir), ROOT);
    runTests(s, dir, 25, PATHS, steady);
    expect(await s.end({ status: 'passed' })).toEqual({ status: 'failed' });
    expect(readOutcome(outcomeFile).exitCode).toBe(2);
    expect(captured.stdout.join('')).toContain('FAILED');
  });

  test('an invalid thresholds file is a tool error: exit code 3, never default thresholds', async () => {
    writeFileSync(join(dir, 'pw-perf-thresholds.json'), '{ not json');
    const outcomeFile = join(dir, 'run.outcome.json');
    const s = session(fakeHost(dir), registered({}, { mode: 'test', outcomeFile }));
    s.begin(fakeConfig(dir), ROOT);
    runTests(s, dir, 25, PATHS, steady);
    expect(await s.end({ status: 'passed' })).toEqual({ status: 'failed' });
    const outcome = readOutcome(outcomeFile);
    expect(outcome.exitCode).toBe(3);
    expect(codes(outcome.toolErrors)).toEqual(['SCHEMA_INVALID_JSON']);
    expect(readReport().evaluation.status).toBe('error');
  });

  test('09-AC-16 with an environment label the file without the label is not used', async () => {
    writeFileSync(
      join(dir, 'pw-perf-thresholds.json'),
      JSON.stringify({ schemaVersion: 1, kind: 'api', generated: null, entries: {} }),
    );
    const s = session(fakeHost(dir), registered({}, { mode: 'test', env: 'qa' }));
    s.begin(fakeConfig(dir), ROOT);
    runTests(s, dir, 5, PATHS, steady);
    await s.end({ status: 'passed' });
    const report = readReport();
    expect(report.env).toBe('qa');
    expect(report.thresholdFiles[0]).toMatchObject({
      kind: 'api',
      path: 'pw-perf-thresholds.qa.json',
      status: 'missing',
    });
    const missing = report.warnings.find((w) => w.code === 'THRESHOLDS_FILE_MISSING');
    expect(missing?.hint).toContain('pw-perf-thresholds.json exists');
  });

  test('04-AC-11 failed tests within gate.maxFailedTestShare warn; above it they are a tool error', async () => {
    for (const [failed, exitCode, code] of [
      [1, 0, 'TESTS_FAILED'],
      [3, 3, 'TESTS_FAILED_TOO_MANY'],
    ] as const) {
      const outcomeFile = join(dir, `run-${failed}.outcome.json`);
      const s = session(fakeHost(dir), registered({}, { mode: 'test', outcomeFile }));
      s.begin(fakeConfig(dir), ROOT);
      runTests(s, dir, 20 - failed, PATHS, steady);
      for (let i = 0; i < failed; i++) {
        s.testBegin();
        s.testEnd(
          fakeTest(dir, { outcome: 'unexpected' }),
          result([batch([request('/api/cart', 100)])], { status: 'failed' }),
        );
      }
      await s.end({ status: 'failed' });
      const outcome = readOutcome(outcomeFile);
      expect(outcome.exitCode).toBe(exitCode);
      const report = readReport();
      expect(report.tests.unexpected).toBe(failed);
      expect(codes([...report.warnings, ...report.toolErrors])).toContain(code);
      // Samples of failed tests are aggregated (D-05).
      expect(report.endpoints['GET /api/cart']?.fromFailedTests).toBe(failed);
    }
  });

  test('RUN_INCOMPLETE for an interrupted run; RUN_SHARDED in onBegin', async () => {
    const outcomeFile = join(dir, 'run.outcome.json');
    const s = session(fakeHost(dir), registered({}, { mode: 'test', outcomeFile }));
    s.begin(fakeConfig(dir, { shard: { current: 1, total: 2 } }), ROOT);
    runTests(s, dir, 3, PATHS, steady);
    expect(await s.end({ status: 'interrupted' })).toEqual({ status: 'failed' });
    const outcome = readOutcome(outcomeFile);
    expect(outcome.exitCode).toBe(3);
    expect(codes(outcome.toolErrors)).toEqual(['RUN_SHARDED', 'RUN_INCOMPLETE']);
  });

  test('04-AC-16 RUN_CONDITIONS_CHANGED for flags in onBegin and traces in onTestEnd, not for retries', async () => {
    const s = session(fakeHost(dir), registered({}, { mode: 'test' }));
    s.begin(
      fakeConfig(dir, {
        workers: 2,
        projects: [project('chromium', { repeatEach: 2, retries: 1 })],
      }),
      ROOT,
    );
    s.testBegin();
    s.testEnd(fakeTest(dir), result([batch([])], { retry: 1 }));
    const traced = result([batch([])]);
    traced.attachments.push({ name: 'trace', contentType: 'application/zip', path: '/t.zip' });
    s.testBegin();
    s.testEnd(fakeTest(dir), traced);
    await s.end({ status: 'passed' });
    const changed = readReport().warnings.filter((w) => w.code === 'RUN_CONDITIONS_CHANGED');
    expect(changed.map((w) => w.message)).toEqual([
      'The run conditions differ from those set for perf mode: workers 2 (expected 1); project "chromium" repeatEach 2 (expected 1).',
      '1 test result has a trace or video attachment, although perf mode turns them off; recording slows the browser down.',
    ]);
  });

  test('attachments: missing, duplicate, invalid and the collector diagnostics', async () => {
    const outcomeFile = join(dir, 'run.outcome.json');
    const s = session(fakeHost(dir), registered({}, { mode: 'test', outcomeFile }));
    s.begin(fakeConfig(dir, { projects: [project('setup'), project('chromium')] }), ROOT);
    // A measured test without the attachment, a skipped one, and a setup test.
    s.testBegin();
    s.testEnd(fakeTest(dir), result([]));
    s.testBegin();
    s.testEnd(fakeTest(dir, { outcome: 'skipped' }), result([], { status: 'skipped' }));
    s.testBegin();
    s.testEnd(fakeTest(dir, { project: 'setup' }), result([]));
    s.testBegin();
    s.testEnd(
      fakeTest(dir, { title: 'twice' }),
      result([
        batch([request('/api/a', 10)], {
          diagnostics: [{ code: 'COLLECTOR_LISTENER_ERROR', message: 'boom' }],
        }),
        batch([request('/api/a', 20)]),
      ]),
    );
    s.testBegin();
    s.testEnd(
      fakeTest(dir, { title: 'broken' }),
      result([JSON.stringify(batch([request('/api/b', 1)], { schemaVersion: 3 as 2 }))]),
    );
    await s.end({ status: 'passed' });
    const report = readReport();
    expect(codes(report.warnings)).toEqual(
      expect.arrayContaining([
        'ATTACHMENT_DUPLICATE',
        'COLLECTOR_LISTENER_ERROR',
        'TESTS_NOT_INSTRUMENTED',
      ]),
    );
    expect(report.warnings.find((w) => w.code === 'TESTS_NOT_INSTRUMENTED')?.message).toMatch(
      /^1 test in tests\/cart\.spec\.ts imports test without withPerfFixtures\(\)/,
    );
    expect(report.endpoints['GET /api/a']?.count).toBe(2);
    // 02-AC-13: the batch of another version is skipped with a tool error.
    expect(report.endpoints['GET /api/b']).toBeUndefined();
    expect(codes(report.toolErrors)).toEqual(['SCHEMA_VERSION_MISMATCH']);
    expect(readOutcome(outcomeFile).exitCode).toBe(3);
  });

  test('09-AC-31 TESTS_NOT_INSTRUMENTED counts tests, names the file, also in thresholds mode', async () => {
    for (const mode of ['test', 'thresholds'] as const) {
      const s = session(fakeHost(dir), registered({}, { mode }));
      s.begin(fakeConfig(dir), ROOT);
      runTests(s, dir, 20, PATHS, steady);
      // 2 unwrapped tests in api.spec.ts with 10 results each.
      for (const id of ['api-1', 'api-2']) {
        for (let r = 0; r < 10; r++) {
          s.testBegin();
          s.testEnd(fakeTest(dir, { id, file: 'api.spec.ts', repeatEachIndex: r }), result([]));
        }
      }
      await s.end({ status: 'passed' });
      const warning = readReport().warnings.find((w) => w.code === 'TESTS_NOT_INSTRUMENTED');
      expect(warning?.message, mode).toBe(
        '2 tests in tests/api.spec.ts import test without withPerfFixtures() (e.g. straight from @playwright/test), so they were not measured.',
      );
      expect(warning?.hint).not.toMatch(/worker/u);
    }
  });

  test('09-AC-31 TESTS_NOT_INSTRUMENTED mentions a crashed worker only when one crashed', async () => {
    const s = session(fakeHost(dir), registered({}, { mode: 'test' }));
    s.begin(fakeConfig(dir), ROOT);
    runTests(s, dir, 20, PATHS, steady);
    const crash = {
      status: 'failed' as const,
      errors: [{ message: 'Error: worker process exited unexpectedly (code=1, signal=null)' }],
    };
    s.testBegin();
    s.testEnd(fakeTest(dir, { id: 'c1', file: 'checkout.spec.ts' }), result([], crash));
    await s.end({ status: 'failed' });
    const warning = readReport().warnings.find((w) => w.code === 'TESTS_NOT_INSTRUMENTED');
    expect(warning?.message).toBe(
      '1 test in tests/checkout.spec.ts lost its measurement because the worker process exited unexpectedly.',
    );
    expect(warning?.hint).toBe('Check the worker crash in the Playwright output above.');
  });

  test('COLLECTOR_REQUESTS_PENDING names the keys with the most pending samples', async () => {
    const s = session(fakeHost(dir), registered({}, { mode: 'test' }));
    s.begin(fakeConfig(dir), ROOT);
    const pending = (path: string): ReturnType<typeof request> =>
      request(path, 0, { status: 'PENDING', duration: null, ttfb: null, requestStart: null });
    s.testBegin();
    s.testEnd(
      fakeTest(dir),
      result([batch([pending('/api/poll'), pending('/api/poll'), pending('/api/sse')])]),
    );
    await s.end({ status: 'passed' });
    const warning = readReport().warnings.find((w) => w.code === 'COLLECTOR_REQUESTS_PENDING');
    expect(warning?.message).toBe(
      '3 requests were still pending at the end of a test; most in: GET /api/poll (2), GET /api/sse (1).',
    );
  });

  test('CONFIG_DUPLICATE_ORIGIN_LABEL for different baseURL origins of measured projects', async () => {
    const s = session(fakeHost(dir), registered({}, { mode: 'test' }, ['a', 'b']));
    s.begin(
      fakeConfig(dir, {
        projects: [
          project('a', { use: { baseURL: 'http://one.test' } }),
          project('b', { use: { baseURL: 'http://two.test/app' } }),
        ],
      }),
      ROOT,
    );
    runTests(s, dir, 1, ['/x'], () => 1, { project: 'a' });
    await s.end({ status: 'passed' });
    const warning = readReport().warnings.find((w) => w.code === 'CONFIG_DUPLICATE_ORIGIN_LABEL');
    expect(warning?.message).toContain(
      '"http://one.test", "http://two.test" share the empty label',
    );
  });

  test('NOT_WRAPPED_WITH_PERF without withPerf(); perf mode off gives no session', async () => {
    expect(runSettings(undefined, {}, '1.0.0')).toBeNull();
    const captured = fakeHost(dir, { env: { PW_PERF_MODE: 'test' } });
    const s = session(captured, undefined);
    s.begin(fakeConfig(dir), ROOT);
    runTests(s, dir, 1, ['/x'], () => 1);
    await s.end({ status: 'passed' });
    const report = readReport();
    expect(report.warnings[0]?.code).toBe('NOT_WRAPPED_WITH_PERF');
    expect(report.tool.version).toBe('0.0.0-test');
    expect(report.endpoints['GET /x']?.count).toBe(1);
  });

  test('an invalid PW_PERF_* value without withPerf() is a tool error', () => {
    const settings = runSettings(undefined, { PW_PERF_MODE: 'bench' }, '1.0.0');
    expect(codes(settings?.toolErrors ?? [])).toEqual(['MODE_INVALID_VALUE']);
  });

  test('01-REQ-16 errors in hooks are tool errors in the report and the outcome', async () => {
    const outcomeFile = join(dir, 'run.outcome.json');
    const s = session(fakeHost(dir), registered({}, { mode: 'test', outcomeFile }));
    s.begin(fakeConfig(dir), ROOT);
    s.testBegin();
    s.recordInternalError('onTestEnd', new Error('kaboom'));
    await s.end({ status: 'passed' });
    const outcome = readOutcome(outcomeFile);
    expect(outcome.exitCode).toBe(3);
    expect(outcome.toolErrors[0]?.code).toBe('REPORTER_INTERNAL_ERROR');
    expect(outcome.toolErrors[0]?.message).toContain('kaboom');
  });

  test('REPORT_WRITE_FAILED and OUTCOME_WRITE_FAILED', async () => {
    writeFileSync(join(dir, 'pw-perf-results'), 'a file, not a directory');
    mkdirSync(join(dir, 'outcome-dir'));
    const captured = fakeHost(dir);
    const s = session(
      captured,
      registered({}, { mode: 'test', outcomeFile: join(dir, 'outcome-dir') }),
    );
    s.begin(fakeConfig(dir), ROOT);
    runTests(s, dir, 1, ['/x'], () => 1);
    expect(await s.end({ status: 'passed' })).toEqual({ status: 'failed' });
    expect(captured.stdout.join('')).toContain('REPORT_WRITE_FAILED');
    expect(captured.stderr.join('')).toContain('OUTCOME_WRITE_FAILED');
  });

  test('04-AC-24 summary colors in a terminal without NO_COLOR, none with NO_COLOR, TERM=dumb or without a terminal, FORCE_COLOR without one', async () => {
    const plain: string[] = [];
    for (const [env, tty, expected] of [
      [{}, 80, true],
      [{ NO_COLOR: '1' }, 80, false],
      [{ TERM: 'dumb' }, 80, false],
      [{}, undefined, false],
      [{ FORCE_COLOR: '1' }, undefined, true],
    ] as const) {
      const captured = fakeHost(dir, { env, ...(tty === undefined ? {} : { tty }) });
      const s = session(captured, registered({}, { mode: 'test' }));
      s.begin(fakeConfig(dir), ROOT);
      runTests(s, dir, 1, ['/x'], () => 1);
      await s.end({ status: 'passed' });
      const text = captured.stdout.join('');
      expect(text.includes('\u001b['), JSON.stringify(env)).toBe(expected);
      if (tty === undefined) plain.push(stripAnsi(text));
    }
    // Without a terminal (width 120) the colored text equals the plain one apart from ANSI.
    expect(plain[1]).toBe(plain[0]);
  });

  test('colors only in a terminal without NO_COLOR; table width from the terminal', async () => {
    for (const [env, expected] of [
      [{}, true],
      [{ NO_COLOR: '1' }, false],
    ] as const) {
      const captured = fakeHost(dir, { env, tty: 80 });
      const s = session(captured, registered({}, { mode: 'test' }));
      s.begin(fakeConfig(dir), ROOT);
      runTests(s, dir, 1, ['/x'], () => 1);
      await s.end({ status: 'passed' });
      expect(captured.stdout.join('').includes('\u001b['), JSON.stringify(env)).toBe(expected);
    }
  });

  test('04-REQ-10 a run id without the CLI', () => {
    expect(generateRunId(new Date(Date.UTC(2026, 10, 18, 10, 0, 0)), () => 0.0408)).toBe(
      '2026-11-18T10-00-00-0a71',
    );
  });
});

describe('reporter session: HTML report', () => {
  const htmlPath = (): string => join(dir, 'pw-perf-results', 'report.html');

  async function run(
    input: Parameters<typeof registered>[0],
    options: Parameters<typeof session>[2] = {},
  ): Promise<{ outcome: Outcome; out: string }> {
    const outcomeFile = join(dir, 'run.outcome.json');
    const captured = fakeHost(dir);
    const s = session(captured, registered(input, { mode: 'test', outcomeFile }), options);
    s.begin(fakeConfig(dir), ROOT);
    runTests(s, dir, 20, PATHS, steady);
    await s.end({ status: 'passed' });
    return { outcome: readOutcome(outcomeFile), out: captured.stdout.join('') };
  }

  test('11-REQ-04 report.html is written next to report.json from the written report', async () => {
    const { outcome } = await run({});
    expect(outcome.exitCode).toBe(0);
    expect(outcome.paths.reportHtml).toBe(htmlPath());
    const page = readFileSync(htmlPath(), 'utf8');
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toBe(renderHtmlReport(readReport()));
  });

  test('11 chapter 12: with report.html false no HTML is written', async () => {
    const { outcome, out } = await run({ report: { html: false } });
    expect(existsSync(htmlPath())).toBe(false);
    expect(outcome.paths.reportHtml).toBeNull();
    expect(out).toContain(`Report: ${slash(dir)}/pw-perf-results/report.json\n`);
  });

  test('11 chapter 13: HTML_RENDER_FAILED keeps report.json, records the error and exit code 3', async () => {
    const { outcome } = await run(
      {},
      {
        renderHtml: () => {
          throw new Error('render bug');
        },
      },
    );
    expect(outcome.exitCode).toBe(3);
    expect(outcome.paths.reportHtml).toBeNull();
    expect(codes(outcome.toolErrors)).toEqual(['HTML_RENDER_FAILED']);
    expect(existsSync(htmlPath())).toBe(false);
    const report = readReport();
    expect(codes(report.toolErrors)).toEqual(['HTML_RENDER_FAILED']);
    expect(report.toolErrors[0]?.message).toContain('render bug');
  });

  test('11 chapter 13: HTML_WRITE_FAILED keeps report.json, records the error and exit code 3', async () => {
    mkdirSync(htmlPath(), { recursive: true });
    const { outcome, out } = await run({});
    expect(outcome.exitCode).toBe(3);
    expect(codes(outcome.toolErrors)).toEqual(['HTML_WRITE_FAILED']);
    expect(codes(readReport().toolErrors)).toEqual(['HTML_WRITE_FAILED']);
    expect(out).toContain('HTML_WRITE_FAILED');
  });
});

describe('reporter session in thresholds mode', () => {
  const thresholdsFile = (): string => join(dir, 'pw-perf-thresholds.json');

  async function derive(
    options: {
      status?: 'passed' | 'interrupted';
      cpu?: string;
      prune?: boolean;
      paths?: string[];
    } = {},
  ): Promise<{ outcome: Outcome; stdout: string }> {
    const outcomeFile = join(dir, 'run.outcome.json');
    const captured = fakeHost(dir);
    if (options.cpu !== undefined) captured.host.host.cpuModel = options.cpu;
    const mode = { mode: 'thresholds' as const, outcomeFile, runId: 'run-t', prune: options.prune };
    const s = session(captured, registered({}, mode));
    s.begin(fakeConfig(dir), ROOT);
    runTests(s, dir, 30, options.paths ?? PATHS, steady);
    await s.end({ status: options.status ?? 'passed' });
    return { outcome: readOutcome(outcomeFile), stdout: captured.stdout.join('') };
  }

  test('derives and writes the thresholds files and the diff, printed after the summary', async () => {
    const { outcome, stdout } = await derive();
    expect(outcome.exitCode).toBe(0);
    expect(outcome.paths.thresholds).toEqual([thresholdsFile()]);
    expect(outcome.paths.thresholdsDiff).toBe(join(dir, 'pw-perf-results', 'thresholds-diff.md'));
    const file = JSON.parse(readFileSync(thresholdsFile(), 'utf8')) as {
      entries: Record<string, unknown>;
      generated: { sourceRunId: string };
    };
    expect(Object.keys(file.entries).sort()).toEqual(['GET /api/cart', 'GET /api/items/:id']);
    expect(file.generated.sourceRunId).toBe('run-t');
    // No file of the removed custom kind is written (D-32).
    expect(existsSync(join(dir, 'pw-perf-thresholds.custom.json'))).toBe(false);
    expect(readFileSync(outcome.paths.thresholdsDiff ?? '', 'utf8')).toContain('# Thresholds diff');
    expect(stdout.indexOf('Thresholds: pw-perf-thresholds.json (created)')).toBeGreaterThan(
      stdout.indexOf('PASSED'),
    );
    expect(stdout).toContain(`Diff: ${join(dir, 'pw-perf-results', 'thresholds-diff.md')}\n`);
  });

  test('09-AC-32 the run that creates the thresholds file does not warn that it is missing', async () => {
    const { outcome, stdout } = await derive();
    expect(outcome.paths.thresholds).toEqual([thresholdsFile()]);
    const report = JSON.parse(readFileSync(outcome.paths.reportJson ?? '', 'utf8')) as {
      warnings: { code: string }[];
    };
    expect(codes(report.warnings)).not.toContain('THRESHOLDS_FILE_MISSING');
    expect(stdout).not.toContain('THRESHOLDS_FILE_MISSING');
  });

  test('02-AC-04 deriving twice from the same samples gives byte-identical files', async () => {
    await derive();
    const first = readFileSync(thresholdsFile());
    const { outcome } = await derive();
    expect(outcome.paths.thresholds).toEqual([]);
    expect(readFileSync(thresholdsFile()).equals(first)).toBe(true);
  });

  test('02-AC-15 another host rewrites the file with the new generated.host', async () => {
    await derive();
    const { outcome } = await derive({ cpu: 'Other CPU' });
    expect(outcome.paths.thresholds).toEqual([thresholdsFile()]);
    const file = JSON.parse(readFileSync(thresholdsFile(), 'utf8')) as {
      generated: { host: { cpuModel: string } };
    };
    expect(file.generated.host.cpuModel).toBe('Other CPU');
  });

  test('04-REQ-36 an interrupted run writes no thresholds file and exits with 3', async () => {
    const { outcome } = await derive({ status: 'interrupted' });
    expect(outcome.exitCode).toBe(3);
    expect(codes(outcome.toolErrors)).toEqual(['RUN_INCOMPLETE', 'THRESHOLDS_SOURCE_INCOMPLETE']);
    expect(existsSync(thresholdsFile())).toBe(false);
    expect(outcome.paths.thresholdsDiff).toBeNull();
  });

  test('PW_PERF_PRUNE removes entries not seen in the run', async () => {
    await derive();
    await derive({ paths: ['/api/cart'] });
    const kept = JSON.parse(readFileSync(thresholdsFile(), 'utf8')) as {
      entries: Record<string, unknown>;
    };
    expect(Object.keys(kept.entries)).toHaveLength(2);
    await derive({ paths: ['/api/cart'], prune: true });
    const pruned = JSON.parse(readFileSync(thresholdsFile(), 'utf8')) as {
      entries: Record<string, unknown>;
    };
    expect(Object.keys(pruned.entries)).toEqual(['GET /api/cart']);
  });

  test('a thresholds path that cannot be read stops the derivation', async () => {
    mkdirSync(thresholdsFile());
    const { outcome } = await derive();
    expect(outcome.exitCode).toBe(3);
    expect(codes(outcome.toolErrors)).toContain('SCHEMA_INVALID_JSON');
  });

  test('THRESHOLDS_WRITE_FAILED when thresholds.dir cannot be created', async () => {
    writeFileSync(join(dir, 'blocked'), 'a file');
    const outcomeFile = join(dir, 'run.outcome.json');
    const mode = { mode: 'thresholds' as const, outcomeFile };
    const s = session(fakeHost(dir), registered({ thresholds: { dir: 'blocked' } }, mode));
    s.begin(fakeConfig(dir), ROOT);
    runTests(s, dir, 30, PATHS, steady);
    await s.end({ status: 'passed' });
    const outcome = readOutcome(outcomeFile);
    expect(outcome.exitCode).toBe(3);
    expect(codes(outcome.toolErrors)).toEqual(['THRESHOLDS_WRITE_FAILED']);
    expect(outcome.paths.thresholds).toEqual([]);
  });
});

describe('environment mode without the CLI (04-REQ-62, 04-REQ-35)', () => {
  const outcomeJson = (): string => join(dir, 'pw-perf-results', 'outcome.json');

  test('04-AC-39 writes pw-perf-results/outcome.json, removes the old one in onBegin and prints the Outcome line', async () => {
    mkdirSync(join(dir, 'pw-perf-results'), { recursive: true });
    writeFileSync(outcomeJson(), '{"stale":true}');
    const captured = fakeHost(dir);
    const s = session(captured, registered({}, { mode: 'test', runId: 'run-e' }));
    s.begin(fakeConfig(dir), ROOT);
    expect(existsSync(outcomeJson())).toBe(false);
    runTests(s, dir, 10, PATHS, steady);
    await s.end({ status: 'passed' });
    const outcome = readOutcome(outcomeJson());
    expect(outcome).toMatchObject({ runId: 'run-e', exitCode: 0 });
    expect(captured.stdout.join('')).toContain(
      `Outcome: performance passed · exit code 0 in ${outcomeJson()} (Playwright exits with 0)\n`,
    );
  });

  test('through the CLI (PW_PERF_OUTCOME_FILE) nothing is written in report.dir and no Outcome line', async () => {
    const captured = fakeHost(dir);
    const outcomeFile = join(dir, 'tmp', 'run.outcome.json');
    const s = session(captured, registered({}, { mode: 'test', outcomeFile }));
    s.begin(fakeConfig(dir), ROOT);
    runTests(s, dir, 10, PATHS, steady);
    await s.end({ status: 'passed' });
    expect(existsSync(outcomeFile)).toBe(true);
    expect(existsSync(outcomeJson())).toBe(false);
    expect(captured.stdout.join('')).not.toContain('Outcome:');
  });

  test('04-REQ-35 PW_PERF_PRUNE with a test filter keeps the entries and warns RUN_PRUNE_SKIPPED', async () => {
    const run = async (paths: string[], argv: string[]): Promise<Outcome> => {
      const captured = fakeHost(dir, { argv });
      const s = session(captured, registered({}, { mode: 'thresholds', prune: true }));
      s.begin(fakeConfig(dir), ROOT);
      runTests(s, dir, 30, paths, steady);
      await s.end({ status: 'passed' });
      return readOutcome(outcomeJson());
    };
    await run(PATHS, ['node', 'playwright', 'test']);
    const skipped = await run(['/api/cart'], ['node', 'playwright', 'test', '--grep', '@perf']);
    const report = JSON.parse(readFileSync(skipped.paths.reportJson ?? '', 'utf8')) as {
      warnings: { code: string }[];
    };
    expect(codes(report.warnings)).toContain('RUN_PRUNE_SKIPPED');
    const file = JSON.parse(readFileSync(join(dir, 'pw-perf-thresholds.json'), 'utf8')) as {
      entries: Record<string, unknown>;
    };
    expect(Object.keys(file.entries)).toHaveLength(2);
  });
});

describe('Next:, RUN_PROJECT_NO_REQUESTS and CONFIG_BASEURL_EMPTY (09-REQ-32, 09-REQ-33, 03-REQ-21)', () => {
  test('09-AC-26 the Next: line is the last line, after the Outcome line', async () => {
    const captured = fakeHost(dir, {
      env: {
        npm_lifecycle_event: 'e2e',
        npm_lifecycle_script: 'playwright test',
        npm_config_user_agent: 'npm/10',
      },
    });
    const s = session(captured, registered({}, { mode: 'test' }));
    s.begin(fakeConfig(dir), ROOT);
    runTests(s, dir, 10, PATHS, steady);
    await s.end({ status: 'passed' });
    const lines = captured.stdout.join('').trimEnd().split('\n');
    expect(lines.at(-2)).toMatch(/^Outcome: /u);
    expect(lines.at(-1)).toBe('Next: derive thresholds: PW_PERF_MODE=thresholds npm run e2e');
  });

  test('09-AC-28 a measured project with batches but no requests gives RUN_PROJECT_NO_REQUESTS', async () => {
    const outcomeFile = join(dir, 'run.outcome.json');
    const s = session(fakeHost(dir), registered({}, { mode: 'test', outcomeFile }));
    s.begin(fakeConfig(dir), ROOT);
    runTests(s, dir, 5, [], steady);
    await s.end({ status: 'passed' });
    const report = JSON.parse(
      readFileSync(join(dir, 'pw-perf-results', 'report.json'), 'utf8'),
    ) as {
      warnings: { code: string; message: string }[];
    };
    const warning = report.warnings.find((w) => w.code === 'RUN_PROJECT_NO_REQUESTS');
    expect(warning?.message).toContain('chromium');

    const other = tempDir();
    const s2 = session(
      fakeHost(other),
      registered({}, { mode: 'test', outcomeFile: join(other, 'o.json') }),
    );
    s2.begin(fakeConfig(other), ROOT);
    runTests(s2, other, 5, PATHS, steady);
    await s2.end({ status: 'passed' });
    const report2 = JSON.parse(
      readFileSync(join(other, 'pw-perf-results', 'report.json'), 'utf8'),
    ) as {
      warnings: { code: string }[];
    };
    expect(codes(report2.warnings)).not.toContain('RUN_PROJECT_NO_REQUESTS');
  });

  test('03-AC-15 an empty or "undefined" baseURL of a measured project warns, a dependency does not', async () => {
    for (const baseURL of ['', 'https://undefined.example.com']) {
      const d = tempDir();
      const s = session(
        fakeHost(d),
        registered({}, { mode: 'test', outcomeFile: join(d, 'o.json') }),
      );
      s.begin(
        fakeConfig(d, {
          projects: [project('setup', { use: {} }), project('chromium', { use: { baseURL } })],
        }),
        ROOT,
      );
      runTests(s, d, 5, PATHS, steady);
      await s.end({ status: 'passed' });
      const report = JSON.parse(
        readFileSync(join(d, 'pw-perf-results', 'report.json'), 'utf8'),
      ) as {
        warnings: { code: string; message: string }[];
      };
      const warning = report.warnings.find((w) => w.code === 'CONFIG_BASEURL_EMPTY');
      expect(warning?.message, baseURL).toBe('Measured project chromium has an empty use.baseURL.');
    }
  });
});
