import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { parseOutcome, parseRunReport } from '../../../src/core/schema/index.ts';
import type { Issue, Outcome, RunReport } from '../../../src/core/types/index.ts';
import { generateRunId } from '../../../src/mode/index.ts';
import { stripAnsi } from '../../../src/console/color.ts';
import { renderHtmlReport } from '../../../src/html/index.ts';
import { buildJunitXml } from '../../../src/core/report/index.ts';
import { configFileNotPassedWarning, runSettings } from '../../../src/reporter/session.ts';
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
  const text = readFileSync(join(dir, 'reports/pw-perf', 'report.json'), 'utf8');
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
    const outcomeFile = join(dir, 'reports/pw-perf', 'outcome.json');
    const captured = fakeHost(dir);
    const s = session(captured, registered({}, { mode: 'test', runId: 'run-1' }));
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
      reportJson: join(dir, 'reports/pw-perf', 'report.json'),
      reportHtml: join(dir, 'reports/pw-perf', 'report.html'),
      thresholds: [],
      thresholdsDiff: null,
    });

    const out = captured.stdout.join('');
    expect(out).toContain(
      'playwright-performance-regression: perf mode overrides trace; reporter list replaced with dot.\n',
    );
    expect(out).toContain('PASSED');
    // One absolute Report path (09-REQ-30).
    expect(out).toContain(`Report: ${slash(dir)}/reports/pw-perf/report.html\n`);
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
    expect(out).toContain('⏳ pw-perf · measurement run');
    expect(out).toContain('Projects  chromium (setup: setup)');
    expect(out).toContain('Tests     2 tests × 5 passes = 10 test runs');
    expect(out).toContain('Estimate  unknown (run PW_PERF_MODE=check for an estimate)');
    expect(out).toContain('Report    reports/pw-perf/report.html');
    expect(out).toContain('Tip       measure a subset, e.g. --grep @perf');
    expect(out).toMatch(/^╭─+╮$/mu);
    expect(out).not.toContain('Continue?');
  });

  test('01-REQ-40 a run without started tests (--list) writes nothing and keeps the status', async () => {
    const outcomeFile = join(dir, 'reports/pw-perf', 'outcome.json');
    const captured = fakeHost(dir);
    const s = session(captured, registered({}, { mode: 'test' }));
    s.begin(fakeConfig(dir), ROOT);
    const printed = captured.stdout.length;
    expect(await s.end({ status: 'passed' })).toBeUndefined();
    expect(existsSync(join(dir, 'reports/pw-perf'))).toBe(false);
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
    const outcomeFile = join(dir, 'reports/pw-perf', 'outcome.json');
    const captured = fakeHost(dir);
    const s = session(captured, registered({}, { mode: 'test' }));
    s.begin(fakeConfig(dir), ROOT);
    runTests(s, dir, 25, PATHS, steady);
    expect(await s.end({ status: 'passed' })).toEqual({ status: 'failed' });
    expect(readOutcome(outcomeFile).exitCode).toBe(2);
    expect(captured.stdout.join('')).toContain('FAILED');
  });

  test('an invalid thresholds file is a tool error: exit code 3, never default thresholds', async () => {
    writeFileSync(join(dir, 'pw-perf-thresholds.json'), '{ not json');
    const outcomeFile = join(dir, 'reports/pw-perf', 'outcome.json');
    const s = session(fakeHost(dir), registered({}, { mode: 'test' }));
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
      const outcomeFile = join(dir, 'reports/pw-perf', 'outcome.json');
      const s = session(fakeHost(dir), registered({}, { mode: 'test' }));
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
    const outcomeFile = join(dir, 'reports/pw-perf', 'outcome.json');
    const s = session(fakeHost(dir), registered({}, { mode: 'test' }));
    s.begin(fakeConfig(dir, { shard: { current: 1, total: 2 } }), ROOT);
    runTests(s, dir, 3, PATHS, steady);
    expect(await s.end({ status: 'interrupted' })).toEqual({ status: 'failed' });
    const outcome = readOutcome(outcomeFile);
    expect(outcome.exitCode).toBe(3);
    expect(codes(outcome.toolErrors)).toEqual(['RUN_SHARDED', 'RUN_INCOMPLETE']);
  });

  test('04-AC-12 only the projects of the run count; a run of setup projects only is CONFIG_NO_MEASURED_PROJECT', async () => {
    const projects = [
      project('setup'),
      project('chromium', { dependencies: ['setup'] }),
      project('firefox', { dependencies: ['setup'], use: { browserName: 'firefox' } }),
    ];
    const suites = (names: string[]) => names.map((name) => ({ project: () => ({ name }) }));
    const measured = ['chromium', 'firefox'];
    // --project firefox: Playwright runs firefox and its setup project.
    const firefox = fakeHost(dir, { env: { NO_COLOR: '1' } });
    const s = session(firefox, registered({}, { mode: 'test' }, measured));
    s.begin(fakeConfig(dir, { projects }), {
      allTests: () => [],
      suites: suites(['setup', 'firefox']),
    });
    expect(firefox.stdout.join('')).toContain('Projects  firefox (setup: setup)');
    // --project setup: nothing is measured.
    const outcomeFile = join(dir, 'reports/pw-perf', 'outcome.json');
    const only = session(fakeHost(dir), registered({}, { mode: 'test' }, measured));
    only.begin(fakeConfig(dir, { projects }), { allTests: () => [], suites: suites(['setup']) });
    runTests(only, dir, 1, PATHS, steady);
    await only.end({ status: 'passed' });
    const outcome = readOutcome(outcomeFile);
    expect(codes(outcome.toolErrors)).toContain('CONFIG_NO_MEASURED_PROJECT');
    expect(outcome.exitCode).toBe(3);
  });

  test('03-AC-22 CONFIG_SLOW_MO only for projects measured in the run', async () => {
    const slow = { baseURL: 'http://app.test', launchOptions: { slowMo: 50 } };
    const projects = [
      project('setup', { use: slow }),
      project('api', { dependencies: ['setup'] }),
      project('e2e', { dependencies: ['setup'], use: slow }),
    ];
    const suites = (names: string[]) => names.map((name) => ({ project: () => ({ name }) }));
    const slowMoWarnings = async (inRun: string[]): Promise<Issue[]> => {
      const s = session(fakeHost(dir), registered({}, { mode: 'test' }, ['api', 'e2e']));
      s.begin(fakeConfig(dir, { projects }), { allTests: () => [], suites: suites(inRun) });
      runTests(s, dir, 1, PATHS, steady);
      await s.end({ status: 'passed' });
      return readReport().warnings.filter((w) => w.code === 'CONFIG_SLOW_MO');
    };
    // --project=api: e2e is outside the run, setup is a dependency.
    expect(await slowMoWarnings(['setup', 'api'])).toEqual([]);
    // --project=e2e, or no --project.
    for (const inRun of [
      ['setup', 'e2e'],
      ['setup', 'api', 'e2e'],
    ]) {
      expect(await slowMoWarnings(inRun)).toEqual([
        expect.objectContaining({
          message:
            'use.launchOptions.slowMo: is greater than 0 in project "e2e"; it slows down every browser action and distorts the measured times',
          hint: 'Remove slowMo from the Playwright config for the measurement run, or set run.overrideSlowMo: true in the package config.',
        }),
      ]);
    }
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
    const outcomeFile = join(dir, 'reports/pw-perf', 'outcome.json');
    const s = session(fakeHost(dir), registered({}, { mode: 'test' }));
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
      result([JSON.stringify(batch([request('/api/b', 1)], { schemaVersion: 4 as 3 }))]),
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
    const outcomeFile = join(dir, 'reports/pw-perf', 'outcome.json');
    const s = session(fakeHost(dir), registered({}, { mode: 'test' }));
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
    mkdirSync(join(dir, 'reports'));
    writeFileSync(join(dir, 'reports/pw-perf'), 'a file, not a directory');
    const captured = fakeHost(dir);
    const s = session(captured, registered({}, { mode: 'test' }));
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
  const htmlPath = (): string => join(dir, 'reports/pw-perf', 'report.html');

  async function run(
    input: Parameters<typeof registered>[0],
    options: Parameters<typeof session>[2] = {},
  ): Promise<{ outcome: Outcome; out: string }> {
    const outcomeFile = join(dir, 'reports/pw-perf', 'outcome.json');
    const captured = fakeHost(dir);
    const s = session(captured, registered(input, { mode: 'test' }), options);
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
    expect(out).toContain(`Report: ${slash(dir)}/reports/pw-perf/report.json\n`);
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
    // A directory in place of report.html, made after the run emptied report.dir (04-REQ-71).
    const { outcome, out } = await run(
      {},
      {
        renderHtml: (report) => {
          mkdirSync(htmlPath(), { recursive: true });
          return renderHtmlReport(report);
        },
      },
    );
    expect(outcome.exitCode).toBe(3);
    expect(codes(outcome.toolErrors)).toEqual(['HTML_WRITE_FAILED']);
    expect(codes(readReport().toolErrors)).toEqual(['HTML_WRITE_FAILED']);
    expect(out).toContain('HTML_WRITE_FAILED');
  });
});

describe('reporter session: junit.xml (16)', () => {
  const junitPath = (): string => join(dir, 'reports/pw-perf', 'junit.xml');

  async function run(
    input: Parameters<typeof registered>[0],
    options: Parameters<typeof session>[2] = {},
    mode: 'test' | 'thresholds' = 'test',
  ): Promise<{ outcome: Outcome; out: string }> {
    const outcomeFile = join(dir, 'reports/pw-perf', 'outcome.json');
    const captured = fakeHost(dir);
    const s = session(captured, registered(input, { mode }), options);
    s.begin(fakeConfig(dir), ROOT);
    runTests(s, dir, 20, PATHS, steady);
    await s.end({ status: 'passed' });
    return { outcome: readOutcome(outcomeFile), out: captured.stdout.join('') };
  }

  test('16-REQ-01 16-REQ-04 test mode writes junit.xml from the written report; outcome.json is unchanged', async () => {
    const { outcome } = await run({});
    expect(outcome.exitCode).toBe(0);
    expect(readFileSync(junitPath(), 'utf8')).toBe(buildJunitXml(readReport()));
    // 16-REQ-15: no junit path in the outcome file (version 1).
    expect(Object.keys(outcome.paths).sort()).toEqual([
      'reportHtml',
      'reportJson',
      'thresholds',
      'thresholdsDiff',
    ]);
  });

  test('16-REQ-02 with report.junit false no junit.xml is written', async () => {
    const { outcome } = await run({ report: { junit: false } });
    expect(outcome.exitCode).toBe(0);
    expect(existsSync(junitPath())).toBe(false);
  });

  test('16-REQ-14 thresholds mode writes no junit.xml', async () => {
    await run({}, {}, 'thresholds');
    expect(existsSync(junitPath())).toBe(false);
  });

  test('16-AC-08 a directory in place of junit.xml gives REPORT_JUNIT_WRITE_FAILED in report.json and exit code 3', async () => {
    const { outcome, out } = await run(
      {},
      {
        buildJunit: (report) => {
          mkdirSync(junitPath(), { recursive: true });
          return buildJunitXml(report);
        },
      },
    );
    expect(outcome.exitCode).toBe(3);
    expect(codes(outcome.toolErrors)).toEqual(['REPORT_JUNIT_WRITE_FAILED']);
    expect(codes(readReport().toolErrors)).toEqual(['REPORT_JUNIT_WRITE_FAILED']);
    expect(out).toContain('REPORT_JUNIT_WRITE_FAILED');
  });

  test('16-AC-08 an exception while building the XML gives REPORT_JUNIT_WRITE_FAILED with its text', async () => {
    const { outcome } = await run(
      {},
      {
        buildJunit: () => {
          throw new Error('junit bug');
        },
      },
    );
    expect(outcome.exitCode).toBe(3);
    expect(existsSync(junitPath())).toBe(false);
    const report = readReport();
    expect(codes(report.toolErrors)).toEqual(['REPORT_JUNIT_WRITE_FAILED']);
    expect(report.toolErrors[0]?.message).toContain('junit bug');
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
    const outcomeFile = join(dir, 'reports/pw-perf', 'outcome.json');
    const captured = fakeHost(dir);
    if (options.cpu !== undefined) captured.host.host.cpuModel = options.cpu;
    const mode = { mode: 'thresholds' as const, runId: 'run-t', prune: options.prune };
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
    expect(outcome.paths.thresholdsDiff).toBe(join(dir, 'reports/pw-perf', 'thresholds-diff.md'));
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
    expect(stdout).toContain(`Diff: ${join(dir, 'reports/pw-perf', 'thresholds-diff.md')}\n`);
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
    const outcomeFile = join(dir, 'reports/pw-perf', 'outcome.json');
    const mode = { mode: 'thresholds' as const };
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

describe('10-AC-23 copies of the thresholds files in report.dir (10-REQ-24)', () => {
  const reportDir = (): string => join(dir, 'reports/pw-perf');
  // Compact JSON without a final newline: the copy must keep the bytes, not re-serialize.
  const EMPTY_STEPS = '{"schemaVersion":1,"kind":"step","generated":null,"entries":{}}';

  async function derive(
    options: {
      thresholds?: { dir: string };
      mode?: { thresholdsDir: string };
      block?: string;
    } = {},
  ): Promise<Outcome> {
    const captured = fakeHost(dir);
    const mode = { mode: 'thresholds' as const, env: 'qa', ...options.mode };
    const input = options.thresholds === undefined ? {} : { thresholds: options.thresholds };
    const s = session(captured, registered(input, mode));
    s.begin(fakeConfig(dir), ROOT);
    runTests(s, dir, 30, PATHS, steady);
    if (options.block !== undefined) {
      // A directory where the copy goes, created after the cleaning of report.dir.
      mkdirSync(join(reportDir(), options.block, 'inside'), { recursive: true });
    }
    await s.end({ status: 'passed' });
    return readOutcome(join(reportDir(), 'outcome.json'));
  }

  test('written and unchanged files of the run env are copied byte for byte, other envs are not', async () => {
    writeFileSync(join(dir, 'pw-perf-thresholds.steps.qa.json'), EMPTY_STEPS);
    writeFileSync(join(dir, 'pw-perf-thresholds.json'), EMPTY_STEPS.replace('step', 'api'));
    const outcome = await derive();
    expect(outcome.exitCode).toBe(0);
    // Only the api file changed; the step file stays as it was and is copied too.
    expect(outcome.paths.thresholds).toEqual([join(dir, 'pw-perf-thresholds.qa.json')]);
    for (const name of ['pw-perf-thresholds.qa.json', 'pw-perf-thresholds.steps.qa.json']) {
      expect(
        readFileSync(join(reportDir(), name)).equals(readFileSync(join(dir, name))),
        name,
      ).toBe(true);
    }
    expect(readFileSync(join(reportDir(), 'pw-perf-thresholds.steps.qa.json'), 'utf8')).toBe(
      EMPTY_STEPS,
    );
    expect(existsSync(join(reportDir(), 'pw-perf-thresholds.json'))).toBe(false);
  });

  test('a missing file of a kind is not copied', async () => {
    await derive();
    expect(existsSync(join(reportDir(), 'pw-perf-thresholds.qa.json'))).toBe(true);
    expect(existsSync(join(reportDir(), 'pw-perf-thresholds.steps.qa.json'))).toBe(false);
  });

  test('a failed copy is the warning THRESHOLDS_COPY_FAILED and the run still exits with 0', async () => {
    const outcome = await derive({ block: 'pw-perf-thresholds.qa.json' });
    expect(outcome.exitCode).toBe(0);
    expect(outcome.toolErrors).toEqual([]);
    expect(existsSync(join(dir, 'pw-perf-thresholds.qa.json'))).toBe(true);
    const report = readReport();
    const warning = report.warnings.find((w) => w.code === 'THRESHOLDS_COPY_FAILED');
    expect(warning?.message).toContain('could not be copied to');
    expect(existsSync(join(reportDir(), 'thresholds-diff.md'))).toBe(true);
  });

  test('THRESHOLDS_WRITE_FAILED and the check of the wizard leave no copies', async () => {
    writeFileSync(join(dir, 'blocked'), 'a file');
    const failed = await derive({ thresholds: { dir: 'blocked' } });
    expect(codes(failed.toolErrors)).toEqual(['THRESHOLDS_WRITE_FAILED']);
    expect(existsSync(join(reportDir(), 'pw-perf-thresholds.qa.json'))).toBe(false);

    const temp = join(dir, 'check-thresholds');
    const check = await derive({ thresholds: { dir: temp }, mode: { thresholdsDir: temp } });
    expect(check.paths.thresholds).toEqual([join(temp, 'pw-perf-thresholds.qa.json')]);
    expect(existsSync(join(reportDir(), 'pw-perf-thresholds.qa.json'))).toBe(false);
  });

  test('04-AC-51 the next run empties report.dir despite the copies', async () => {
    await derive();
    writeFileSync(join(reportDir(), 'stale.txt'), 'old');
    const outcome = await derive();
    expect(codes(readReport().warnings)).not.toContain('RUN_REPORT_DIR_NOT_CLEANED');
    expect(existsSync(join(reportDir(), 'stale.txt'))).toBe(false);
    expect(outcome.exitCode).toBe(0);
    expect(existsSync(join(reportDir(), 'pw-perf-thresholds.qa.json'))).toBe(true);
  });
});

describe('environment mode without the CLI (04-REQ-62, 04-REQ-35)', () => {
  const outcomeJson = (): string => join(dir, 'reports/pw-perf', 'outcome.json');

  test('04-AC-39 writes reports/pw-perf/outcome.json, removes the old one in onBegin and prints the Outcome line', async () => {
    mkdirSync(join(dir, 'reports/pw-perf'), { recursive: true });
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
      `Outcome: Playwright exit code 0 · details: performance passed (code 0) in ${outcomeJson()}\n`,
    );
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

describe('CONFIG_FILE_NOT_PASSED (03-REQ-29)', () => {
  const warningsOf = async (perfConfigPassed: boolean | undefined): Promise<Issue[]> => {
    const state = registered({}, { mode: 'test' });
    const s = session(
      fakeHost(dir),
      perfConfigPassed === undefined ? state : { ...state, perfConfigPassed },
    );
    s.begin(fakeConfig(dir), ROOT);
    runTests(s, dir, 5, PATHS, steady);
    await s.end({ status: 'passed' });
    return readReport().warnings;
  };

  test('03-AC-21 a config file next to the Playwright config and withPerf(config) warn', async () => {
    writeFileSync(join(dir, 'pw-perf.config.ts'), 'export default {};\n');
    const found = (await warningsOf(false)).find((w) => w.code === 'CONFIG_FILE_NOT_PASSED');
    expect(found?.message).toBe(
      'pw-perf.config.ts is not passed to withPerf(), so the run uses the default settings.',
    );
    expect(found?.hint).toContain('withPerf(config, perfConfig)');
  });

  test('03-AC-21 no warning with the config passed, without a file or with a file elsewhere', async () => {
    writeFileSync(join(dir, 'pw-perf.config.ts'), 'export default {};\n');
    expect(codes(await warningsOf(true))).not.toContain('CONFIG_FILE_NOT_PASSED');
    expect(codes(await warningsOf(undefined))).not.toContain('CONFIG_FILE_NOT_PASSED');
    rmSync(join(dir, 'pw-perf.config.ts'));
    mkdirSync(join(dir, 'e2e'));
    writeFileSync(join(dir, 'e2e', 'pw-perf.config.ts'), 'export default {};\n');
    writeFileSync(join(dir, 'pw-perf.config.yaml'), '');
    expect(codes(await warningsOf(false))).not.toContain('CONFIG_FILE_NOT_PASSED');
  });

  test('03-AC-21 configFileNotPassedWarning knows every config file extension', () => {
    for (const ext of ['.ts', '.mts', '.js', '.mjs', '.cjs', '.json']) {
      expect(configFileNotPassedWarning([`pw-perf.config${ext}`])?.code).toBe(
        'CONFIG_FILE_NOT_PASSED',
      );
    }
    expect(configFileNotPassedWarning(['playwright.config.ts'])).toBeNull();
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

  test('09-AC-34 Next: starts with cd below INIT_CWD and derives thresholds without the arguments', async () => {
    const run = async (initCwd: string): Promise<string | undefined> => {
      const captured = fakeHost(dir, {
        env: {
          npm_lifecycle_event: 'e2e',
          npm_execpath: '/usr/lib/node_modules/npm/bin/npm-cli.js',
          npm_config_user_agent: 'npm/10',
          INIT_CWD: initCwd,
        },
        argv: ['node', 'playwright', 'test', '--project=desktop'],
      });
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ scripts: { e2e: 'playwright test' } }),
      );
      const s = session(captured, registered({}, { mode: 'test' }));
      s.begin(fakeConfig(dir), ROOT);
      runTests(s, dir, 10, PATHS, steady);
      await s.end({ status: 'passed' });
      return captured.stdout.join('').trimEnd().split('\n').at(-1);
    };
    expect(await run(join(dir, '..'))).toBe(
      `Next: derive thresholds: cd ${basename(dir)} && PW_PERF_MODE=thresholds npm run e2e`,
    );
    // An INIT_CWD below the test directory comes from an unrelated script: no cd.
    expect(await run(join(dir, 'nested'))).toBe(
      'Next: derive thresholds: PW_PERF_MODE=thresholds npm run e2e',
    );
  });

  test('09-AC-28 a measured project with batches but no requests gives RUN_PROJECT_NO_REQUESTS', async () => {
    const s = session(fakeHost(dir), registered({}, { mode: 'test' }));
    s.begin(fakeConfig(dir), ROOT);
    runTests(s, dir, 5, [], steady);
    await s.end({ status: 'passed' });
    const report = JSON.parse(
      readFileSync(join(dir, 'reports/pw-perf', 'report.json'), 'utf8'),
    ) as {
      warnings: { code: string; message: string; hint?: string }[];
    };
    const warning = report.warnings.find((w) => w.code === 'RUN_PROJECT_NO_REQUESTS');
    expect(warning?.message).toContain('chromium');
    expect(warning?.hint).toContain('trackRequestContext()');

    const other = tempDir();
    const s2 = session(fakeHost(other), registered({}, { mode: 'test' }));
    s2.begin(fakeConfig(other), ROOT);
    runTests(s2, other, 5, PATHS, steady);
    await s2.end({ status: 'passed' });
    const report2 = JSON.parse(
      readFileSync(join(other, 'reports/pw-perf', 'report.json'), 'utf8'),
    ) as {
      warnings: { code: string }[];
    };
    expect(codes(report2.warnings)).not.toContain('RUN_PROJECT_NO_REQUESTS');
  });

  test('15-AC-01 API calls of a batch become request keys in endpoints and count as requests', async () => {
    const s = session(fakeHost(dir), registered({}, { mode: 'test' }));
    s.begin(fakeConfig(dir), ROOT);
    s.testBegin();
    const call = {
      method: 'GET',
      url: 'http://app.test/api/a',
      status: 200 as const,
      startTime: 1_763_460_000_000,
      duration: 210.5,
      source: 'request' as const,
    };
    s.testEnd(
      fakeTest(dir, { title: 'api' }),
      result([JSON.stringify(batch([], { apiRequests: [call, { ...call, duration: 190 }] }))]),
    );
    await s.end({ status: 'passed' });
    const report = JSON.parse(
      readFileSync(join(dir, 'reports/pw-perf', 'report.json'), 'utf8'),
    ) as RunReport;
    expect(Object.keys(report.endpoints)).toEqual(['request GET /api/a']);
    expect(report.endpoints['request GET /api/a']).toMatchObject({ count: 2, successCount: 2 });
    expect(codes(report.warnings)).not.toContain('RUN_PROJECT_NO_REQUESTS');
  });

  test('02-AC-23 suite from package.json or the config path; requestOnly for request-only projects', async () => {
    const call = {
      method: 'GET',
      url: 'http://app.test/api/a',
      status: 200 as const,
      startTime: 1_763_460_000_000,
      duration: 210.5,
      source: 'request' as const,
    };
    // The config directory one level below a repository root, without package.json.
    mkdirSync(join(dir, '.git'));
    const app = join(dir, 'apps', 'web');
    mkdirSync(app, { recursive: true });
    const run = async (): Promise<RunReport> => {
      const s = session(fakeHost(app), registered({}, { mode: 'test' }, ['chromium', 'api']));
      s.begin(fakeConfig(app, { projects: [project('chromium'), project('api')] }), ROOT);
      s.testBegin();
      s.testEnd(fakeTest(app), result([batch([request('/api/b', 50)])]));
      s.testBegin();
      s.testEnd(
        fakeTest(app, { project: 'api' }),
        result([JSON.stringify(batch([], { apiRequests: [call] }))]),
      );
      await s.end({ status: 'passed' });
      const text = readFileSync(join(app, 'reports/pw-perf', 'report.json'), 'utf8');
      expect(validReport(JSON.parse(text)), JSON.stringify(validReport.errors)).toBe(true);
      return JSON.parse(text) as RunReport;
    };
    let report = await run();
    expect(report.suite).toEqual({ name: 'apps/web/playwright.config.ts', source: 'config' });
    expect(report.runConditions.projects.map((p) => [p.name, p.requestOnly])).toEqual([
      ['chromium', undefined],
      ['api', true],
    ]);
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: '@acme/web' }));
    report = await run();
    expect(report.suite).toEqual({ name: '@acme/web', source: 'package' });
    // A report without both fields stays valid.
    const { suite: _suite, ...rest } = report;
    rest.runConditions.projects = rest.runConditions.projects.map(({ requestOnly: _r, ...p }) => p);
    expect(validReport(rest)).toBe(true);
  });

  test('03-AC-15 an empty or "undefined" baseURL of a measured project warns, a dependency does not', async () => {
    for (const baseURL of ['', 'https://undefined.example.com']) {
      const d = tempDir();
      const s = session(fakeHost(d), registered({}, { mode: 'test' }));
      s.begin(
        fakeConfig(d, {
          projects: [project('setup', { use: {} }), project('chromium', { use: { baseURL } })],
        }),
        ROOT,
      );
      runTests(s, d, 5, PATHS, steady);
      await s.end({ status: 'passed' });
      const report = JSON.parse(
        readFileSync(join(d, 'reports/pw-perf', 'report.json'), 'utf8'),
      ) as {
        warnings: { code: string; message: string }[];
      };
      const warning = report.warnings.find((w) => w.code === 'CONFIG_BASEURL_EMPTY');
      expect(warning?.message, baseURL).toBe('Measured project chromium has an empty use.baseURL.');
    }
  });
});
