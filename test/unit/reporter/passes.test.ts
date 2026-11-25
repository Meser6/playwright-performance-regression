// Passes of a perf-mode run (D-39, 04 chapter 4.12): pass files, the pass loop of the first pass,
// merging and the start banner (no question, v4 B3). Later passes are reporter sessions of
// their own, started by the fake host instead of a process.
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { parseRunReport } from '../../../src/core/schema/index.ts';
import type { RunReport } from '../../../src/core/types/index.ts';
import { stripAnsi } from '../../../src/console/color.ts';
import { formatStartBanner } from '../../../src/console/start-banner.ts';
import { textWidth } from '../../../src/console/text.ts';
import { parsePassFile } from '../../../src/reporter/pass-file.ts';
import type { ReporterHost, TestLike } from '../../../src/reporter/types.ts';
import {
  batch,
  fakeConfig,
  fakeHost,
  fakeTest,
  registered,
  request,
  result,
  session,
  tempDir,
} from './harness.ts';

let dir: string;
beforeEach(() => {
  dir = tempDir();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const RUN_ID = '2026-11-21T10-00-00-abcd';
const RESULTS = join('reports/pw-perf');

function readReport(): RunReport {
  const text = readFileSync(join(dir, RESULTS, 'report.json'), 'utf8');
  const parsed = parseRunReport(text, 'report.json');
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
}

/** The same test object in every pass: one id, repeatEachIndex 0. */
function sameTest(index: number, extra: Partial<TestLike> = {}): TestLike {
  return { ...fakeTest(dir), id: 'cart-test', ...extra, repeatEachIndex: index };
}

/** Durations of pass k: a different set per pass, so a lost pass changes the aggregates. */
const ms = (pass: number, i: number): number => 40 + pass * 10 + i;

/** Runs the tests of pass `pass` in a session. */
function runPass(s: ReturnType<typeof session>, pass: number, repeatEachIndex = 0): void {
  for (let i = 0; i < 3; i += 1) {
    s.testBegin();
    s.testEnd(
      sameTest(repeatEachIndex, { title: `item ${String(i)}`, id: `t-${String(i)}` }),
      result([
        batch([request('/api/items/1', ms(pass, i)), request('/api/cart', ms(pass, i) * 2)]),
      ]),
    );
  }
}

/**
 * A fake runPass that runs pass k as its own reporter session in the same directory, the way the
 * real process would; `broken` passes exit without a pass file.
 */
function laterPasses(
  broken: number[] = [],
  extra: (s: ReturnType<typeof session>) => void = () => undefined,
): ReporterHost['runPass'] {
  return async (_command, env) => {
    const [index, total] = (env['PW_PERF_PASS'] ?? '').split('/').map(Number);
    if (index === undefined || total === undefined) throw new Error('no PW_PERF_PASS');
    if (broken.includes(index)) return { code: 1, signal: null };
    const later = fakeHost(dir);
    const s = session(
      later,
      registered(
        { run: { passes: { test: total } } },
        { mode: 'test', runId: env['PW_PERF_RUN_ID'] ?? '', pass: { index, total } },
      ),
    );
    s.begin(fakeConfig(dir), { allTests: () => [] });
    runPass(s, index);
    extra(s);
    await s.end({ status: 'passed' });
    later.stdout.forEach((line) => {
      if (!line.includes(`pass ${String(index)}/`)) throw new Error(`unexpected output ${line}`);
    });
    return { code: 0, signal: null };
  };
}

describe('passes of the first pass (04-REQ-64)', () => {
  test('04-AC-64 the pass line shows the command as the user types it, without absolute paths', async () => {
    const first = fakeHost(dir, {
      runPass: laterPasses(),
      argv: ['/usr/bin/node', '/app/node_modules/.bin/playwright', 'test', '--grep', '@cart smoke'],
    });
    const s = session(first, registered({ run: { passes: { test: 2 } } }, { mode: 'test' }));
    s.begin(fakeConfig(dir), { allTests: () => [] });
    runPass(s, 1);
    await s.end({ status: 'passed' });
    const out = first.stdout.map(stripAnsi).join('');
    expect(out).toContain("pass 2/2: npx playwright test --grep '@cart smoke'\n");
    expect(out).not.toContain('/usr/bin/node');
  });

  test('04-AC-68 npx inside a script: the next pass runs the script of the ancestor', async () => {
    const project = tempDir();
    writeFileSync(
      join(project, 'package.json'),
      JSON.stringify({
        scripts: {
          'e2e:qa': 'npm run tic:qa && INSTANCE=QA npx playwright test --grep "$(echo @a)"',
        },
      }),
    );
    const npm = '/usr/lib/node_modules/npm/bin/npm-cli.js';
    const first = fakeHost(project, {
      runPass: laterPasses(),
      env: {
        npm_lifecycle_event: 'npx',
        npm_lifecycle_script: 'playwright test',
        npm_execpath: npm,
      },
      argv: ['/usr/bin/node', '/p/node_modules/.bin/playwright', 'test', '--grep', '@a'],
      processTable: [
        '200 1 node /usr/local/bin/npm run e2e:qa',
        '300 200 sh -c npm run tic:qa && INSTANCE=QA npx playwright test',
        `400 300 node ${npm} exec playwright test --grep @a`,
        '500 400 node /p/node_modules/.bin/playwright test --grep @a',
      ].join('\n'),
    });
    const s = session(first, registered({ run: { passes: { test: 2 } } }, { mode: 'test' }));
    s.begin(fakeConfig(project), { allTests: () => [] });
    runPass(s, 1);
    await s.end({ status: 'passed' });
    expect(first.passes[0]?.command).toEqual({
      file: '/usr/bin/node',
      args: [npm, 'run', 'e2e:qa'],
    });
    expect(first.stdout.map(stripAnsi).join('')).toContain('pass 2/2: npm run e2e:qa\n');
  });

  test('09-AC-31 TESTS_NOT_INSTRUMENTED counts a test once over all passes', async () => {
    const unwrapped = (s: ReturnType<typeof session>): void => {
      s.testBegin();
      s.testEnd({ ...fakeTest(dir, { file: 'api.spec.ts' }), id: 'api-1' }, result([]));
    };
    const first = fakeHost(dir, { runPass: laterPasses([], unwrapped) });
    const s = session(
      first,
      registered({ run: { passes: { test: 3 } } }, { mode: 'test', runId: RUN_ID }),
    );
    s.begin(fakeConfig(dir), { allTests: () => [] });
    runPass(s, 1);
    unwrapped(s);
    await s.end({ status: 'passed' });
    const warning = readReport().warnings.find((w) => w.code === 'TESTS_NOT_INSTRUMENTED');
    expect(warning?.message).toMatch(/^1 test in tests\/api\.spec\.ts imports test/u);
  });

  test('02-AC-20 three passes give the same aggregates as the same results in one process', async () => {
    const first = fakeHost(dir, { runPass: laterPasses() });
    const s = session(
      first,
      registered({ run: { passes: { test: 3 } } }, { mode: 'test', runId: RUN_ID }),
    );
    s.begin(fakeConfig(dir), { allTests: () => [] });
    runPass(s, 1);
    await s.end({ status: 'passed' });
    const merged = readReport();
    expect(merged.passes).toEqual({ planned: 3, completed: 3, failed: [] });
    expect(merged.tests).toMatchObject({ expected: 9, unexpected: 0 });
    expect(first.passes.map((p) => p.env['PW_PERF_PASS'])).toEqual(['2/3', '3/3']);
    expect(first.passes.every((p) => p.env['PW_PERF_RUN_ID'] === RUN_ID)).toBe(true);
    expect(
      readdirSync(join(dir, RESULTS))
        .filter((f) => f.startsWith('pass-'))
        .sort(),
    ).toEqual(['pass-1.json', 'pass-2.json', 'pass-3.json']);

    // The same results in one process, with the repetition index of each pass (08-REQ-08).
    rmSync(join(dir, RESULTS), { recursive: true, force: true });
    const single = session(fakeHost(dir), registered({}, { mode: 'test', runId: RUN_ID }));
    single.begin(fakeConfig(dir), { allTests: () => [] });
    for (const pass of [1, 2, 3]) runPass(single, pass, pass - 1);
    await single.end({ status: 'passed' });
    const one = readReport();
    expect(merged.endpoints).toEqual(one.endpoints);
    expect(merged.testBreakdown).toEqual(one.testBreakdown);
    expect(merged.origins).toEqual(one.origins);
  });

  test('04-AC-43 a pass without a pass file is RUN_PASS_FAILED; the other passes are evaluated', async () => {
    const first = fakeHost(dir, { runPass: laterPasses([2]) });
    const s = session(
      first,
      registered({ run: { passes: { test: 3 } } }, { mode: 'test', runId: RUN_ID }),
    );
    s.begin(fakeConfig(dir), { allTests: () => [] });
    runPass(s, 1);
    await s.end({ status: 'passed' });
    const report = readReport();
    expect(report.passes).toEqual({ planned: 3, completed: 2, failed: [2] });
    expect(report.tests.expected).toBe(6);
    const failed = report.warnings.filter((w) => w.code === 'RUN_PASS_FAILED');
    expect(failed.map((w) => w.message)).toEqual([
      'pass 2/3 produced no results (exit code 1: no pass file was written), e.g. a setup step of the test script failed.',
    ]);
    expect(report.toolErrors).toEqual([]);
  });

  test('02-AC-20 a pass file of another run, version or pass is RUN_PASS_FAILED', async () => {
    const results = join(dir, RESULTS);
    const write =
      (text: string): ReporterHost['runPass'] =>
      async () => {
        mkdirSync(results, { recursive: true });
        writeFileSync(join(results, 'pass-2.json'), text);
        return { code: 0, signal: null };
      };
    const good = {
      format: 'pw-perf-pass',
      schemaVersion: 1,
      toolVersion: '0.0.0-test',
      runId: RUN_ID,
      pass: { index: 2, total: 2 },
      tests: {},
      counters: {},
      warnings: [],
      toolErrors: [],
      entries: [],
    };
    for (const [text, reason] of [
      ['{', 'the file is not valid JSON'],
      [JSON.stringify({ ...good, runId: 'other' }), 'the file belongs to run "other"'],
      [JSON.stringify({ ...good, toolVersion: '9.9.9' }), 'another package version'],
      [JSON.stringify({ ...good, pass: { index: 3, total: 2 } }), 'another pass'],
    ] as const) {
      rmSync(results, { recursive: true, force: true });
      const first = fakeHost(dir, { runPass: write(text) });
      const s = session(
        first,
        registered({ run: { passes: { test: 2 } } }, { mode: 'test', runId: RUN_ID }),
      );
      s.begin(fakeConfig(dir), { allTests: () => [] });
      runPass(s, 1);
      await s.end({ status: 'passed' });
      const report = readReport();
      expect(report.passes.failed, reason).toEqual([2]);
      expect(report.warnings.find((w) => w.code === 'RUN_PASS_FAILED')?.message).toContain(reason);
    }
    const expected = { toolVersion: '0.0.0-test', runId: RUN_ID, index: 2, total: 2 };
    expect(parsePassFile(JSON.stringify(good), expected).ok).toBe(true);
  });

  test('04-REQ-64 an interrupted pass stops the passes with RUN_PASS_INTERRUPTED (exit code 3)', async () => {
    const first = fakeHost(dir, { runPass: async () => ({ code: null, signal: 'SIGINT' }) });
    const outcomeFile = join(dir, 'reports/pw-perf', 'outcome.json');
    const s = session(
      first,
      registered({ run: { passes: { test: 4 } } }, { mode: 'test', runId: RUN_ID }),
    );
    s.begin(fakeConfig(dir), { allTests: () => [] });
    runPass(s, 1);
    expect(await s.end({ status: 'passed' })).toEqual({ status: 'failed' });
    expect(first.passes).toHaveLength(1);
    const report = readReport();
    expect(report.passes).toEqual({ planned: 4, completed: 1, failed: [] });
    expect(report.toolErrors.map((i) => i.message)).toEqual([
      'pass 2/4 was interrupted (SIGINT); passes 3–4 did not run.',
    ]);
    expect(JSON.parse(readFileSync(outcomeFile, 'utf8')).exitCode).toBe(3);
  });

  test('04-REQ-64 an interrupted first pass and a filter without tests start no pass', async () => {
    const first = fakeHost(dir);
    const s = session(first, registered({ run: { passes: { test: 3 } } }, { mode: 'test' }));
    s.begin(fakeConfig(dir), { allTests: () => [] });
    runPass(s, 1);
    await s.end({ status: 'interrupted' });
    expect(first.passes).toEqual([]);
    expect(readReport().toolErrors.map((i) => i.code)).toContain('RUN_INCOMPLETE');

    const none = fakeHost(dir);
    const empty = session(none, registered({ run: { passes: { test: 3 } } }, { mode: 'test' }));
    empty.begin(fakeConfig(dir), { allTests: () => [] });
    expect(await empty.end({ status: 'passed' })).toBeUndefined();
    expect(none.passes).toEqual([]);
  });

  test('04-REQ-64 failed tests in a later pass fail the command in the environment mode', async () => {
    // 1 failed of 4 test runs stays below the failed share, so the outcome is 0.
    const TOLERANT = { run: { passes: { test: 2 } }, gate: { maxFailedTestShare: 0.5 } };
    const failing: ReporterHost['runPass'] = async (_c, env) => {
      const s = session(
        fakeHost(dir),
        registered(TOLERANT, { mode: 'test', runId: RUN_ID, pass: { index: 2, total: 2 } }),
      );
      s.begin(fakeConfig(dir), { allTests: () => [] });
      s.testBegin();
      s.testEnd(
        sameTest(0, { outcome: () => 'unexpected' }),
        result([batch([request('/api/cart', 50)])], { status: 'failed' }),
      );
      await s.end({ status: 'failed' });
      expect(env['PW_PERF_RUN_ID']).toBe(RUN_ID);
      return { code: 1, signal: null };
    };
    const s = session(
      fakeHost(dir, { runPass: failing }),
      registered(TOLERANT, { mode: 'test', runId: RUN_ID }),
    );
    s.begin(fakeConfig(dir), { allTests: () => [] });
    runPass(s, 1);
    expect(await s.end({ status: 'passed' })).toEqual({ status: 'failed' });
    const report = readReport();
    expect(report.tests).toMatchObject({ status: 'failed', expected: 3, unexpected: 1 });
    expect(report.warnings.map((w) => w.code)).toContain('TESTS_FAILED');
  });

  test('02-REQ-36 pass files keep no raw URL and are removed when the next run starts', async () => {
    const first = fakeHost(dir, { runPass: laterPasses() });
    const s = session(
      first,
      registered({ run: { passes: { test: 2 } } }, { mode: 'test', runId: RUN_ID }),
    );
    s.begin(fakeConfig(dir), { allTests: () => [] });
    runPass(s, 1);
    await s.end({ status: 'passed' });
    const pass1 = readFileSync(join(dir, RESULTS, 'pass-1.json'), 'utf8');
    // Origins are in the report too; full URLs only with report.rawUrls (02-REQ-16).
    expect(pass1).not.toContain('http://app.test/api');

    const next = session(fakeHost(dir), registered({}, { mode: 'test' }));
    next.begin(fakeConfig(dir), { allTests: () => [] });
    expect(existsSync(join(dir, RESULTS, 'pass-1.json'))).toBe(false);
    expect(existsSync(join(dir, RESULTS, 'pass-2.json'))).toBe(false);
  });

  test('04-AC-16 a flaky test with retries gives the samples of both attempts and no TESTS_FAILED', async () => {
    const s = session(fakeHost(dir), registered({}, { mode: 'test' }));
    s.begin(fakeConfig(dir), { allTests: () => [] });
    const flaky = sameTest(0, { outcome: () => 'flaky' });
    s.testBegin();
    s.testEnd(flaky, result([batch([request('/api/cart', 50)])], { status: 'failed', retry: 0 }));
    s.testBegin();
    s.testEnd(flaky, result([batch([request('/api/cart', 60)])], { status: 'passed', retry: 1 }));
    await s.end({ status: 'passed' });
    const report = readReport();
    expect(report.endpoints['GET /api/cart']?.count).toBe(2);
    expect(report.endpoints['GET /api/cart']?.fromFailedTests).toBe(1);
    expect(report.tests).toMatchObject({ flaky: 1, unexpected: 0 });
    const codes = report.warnings.map((w) => w.code);
    expect(codes).not.toContain('TESTS_FAILED');
    expect(codes).not.toContain('RUN_CONDITIONS_CHANGED');
  });
});

describe('start banner (04-REQ-65, 04-REQ-66)', () => {
  test('04-AC-44 NO_COLOR has no ANSI sequences; TERM=dumb gives an ASCII frame without emoji', () => {
    const input = {
      packageName: 'pw-perf',
      mode: 'thresholds' as const,
      measured: ['chromium'],
      dependencies: [],
      tests: 4,
      passes: 10,
      estimate: 'unknown (run PW_PERF_MODE=check for an estimate)',
      report: 'reports/pw-perf/report.html',
      tip: false,
    };
    const colored = formatStartBanner(input, { width: 120, color: true, ascii: false });
    expect(colored).toContain('\u001b[36m');
    expect(stripAnsi(colored)).toBe(
      formatStartBanner(input, { width: 120, color: false, ascii: false }),
    );
    const dumb = formatStartBanner(input, { width: 120, color: false, ascii: true });
    // A table without a header row and with the title in its top edge (09-REQ-27, 09-D-24).
    expect(dumb.split('\n')[0]).toMatch(/^\+- pw-perf · thresholds run -+\+$/u);
    expect(dumb).toContain('| Tests    | 4 tests × 10 passes = 40 test runs');
    expect(dumb.trimEnd().split('\n').at(-1)).toMatch(/^\+-{10}\+-+\+$/u);
    expect(dumb).not.toContain('⏳');
    expect(dumb).not.toContain('Tip');
    const narrow = formatStartBanner(input, { width: 30, color: false, ascii: false });
    expect(narrow.split('\n').every((line) => textWidth(line) <= 30)).toBe(true);
    const check = formatStartBanner(
      { ...input, mode: 'check', estimate: null, report: null, maxTests: 10 },
      { width: 120, color: false, ascii: false },
    );
    expect(check).toContain(
      'Tests    │ 4 tests; the first test of each file runs once, at most 10',
    );
    expect(check).toContain('Report   │ no files are written');
    expect(check).not.toContain('Estimate');
  });

  test('04-AC-44 no question in a terminal outside CI: the banner only informs and the run goes on', async () => {
    const captured = fakeHost(dir, { tty: 80 });
    const s = session(captured, registered({}, { mode: 'test' }));
    s.begin(fakeConfig(dir), { allTests: () => [fakeTest(dir)] });
    const out = captured.stdout.join('');
    expect(out).toContain('pw-perf · measurement run');
    expect(out).not.toContain('Continue?');
    expect(out).not.toContain('cancelled');
    s.testBegin();
    await s.end({ status: 'passed' });
    expect(existsSync(join(dir, RESULTS, 'report.json'))).toBe(true);
  });

  test('04-AC-44 a later pass prints one line instead of the banner', () => {
    const captured = fakeHost(dir);
    const s = session(
      captured,
      registered({ run: { passes: { test: 3 } } }, { mode: 'test', pass: { index: 2, total: 3 } }),
    );
    s.begin(fakeConfig(dir), { allTests: () => [fakeTest(dir)] });
    expect(captured.stdout.map(stripAnsi)).toEqual([
      'playwright-performance-regression: pass 2/3 (perf mode "test")\n',
    ]);
  });

  test('04-AC-45 the estimate comes from the last run report, else it is unknown', async () => {
    // 10 test runs in 100 s: 10 s per test, × 4 tests × 5 passes = 200 s.
    const earlier = session(fakeHost(dir), registered({}, { mode: 'test' }));
    earlier.begin(fakeConfig(dir), { allTests: () => [] });
    for (let i = 0; i < 10; i += 1) {
      earlier.testBegin();
      earlier.testEnd(fakeTest(dir), result([batch([request('/api/cart', 50)])]));
    }
    await earlier.end({ status: 'passed' });
    const path = join(dir, RESULTS, 'report.json');
    const report = JSON.parse(readFileSync(path, 'utf8')) as RunReport;
    report.startedAt = '2026-11-21T10:00:00.000Z';
    report.finishedAt = '2026-11-21T10:01:40.000Z';
    writeFileSync(path, JSON.stringify(report));

    const banner = (): string => {
      const captured = fakeHost(dir);
      const s = session(captured, registered({ run: { passes: { test: 5 } } }, { mode: 'test' }));
      s.begin(fakeConfig(dir), { allTests: () => [1, 2, 3, 4].map(() => fakeTest(dir)) });
      return captured.stdout.join('');
    };
    expect(banner()).toContain('Estimate │ ≈ 4 min (from the last run)');
    rmSync(path);
    expect(banner()).toContain('Estimate │ unknown (run PW_PERF_MODE=check for an estimate)');
  });

  test('04-AC-45 no Tip when run.grep selects the measured tests', () => {
    const banner = (grep: string | null): string => {
      const captured = fakeHost(dir);
      const s = session(captured, registered({ run: { grep } }, { mode: 'test' }));
      s.begin(fakeConfig(dir), { allTests: () => [fakeTest(dir)] });
      return captured.stdout.join('');
    };
    expect(banner(null)).toContain('Tip      │ measure a subset');
    expect(banner('@smoke')).not.toContain('Tip');
  });
});
