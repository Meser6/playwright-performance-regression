// Sharded perf runs and the shard merge (17) with fake Playwright objects: the shard file, the
// output of a shard, the validation of the shard set and the merged report.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { PerfConfigInput } from '../../../src/core/config/index.ts';
import { parseOutcome, parseRunReport } from '../../../src/core/schema/index.ts';
import type { Outcome, RunReport } from '../../../src/core/types/index.ts';
import { formatStartBanner } from '../../../src/console/start-banner.ts';
import { runMerge, validateShardSet } from '../../../src/reporter/merge.ts';
import type { ShardFile } from '../../../src/reporter/shard-file.ts';
import { parseShardFile, shardFileName } from '../../../src/reporter/shard-file.ts';
import { createAjv, validator } from '../../contract/schemas.ts';
import {
  HOST_INFO,
  batch,
  fakeConfig,
  fakeHost,
  fakeTest,
  registered,
  request,
  result,
  runTests,
  session,
  tempDir,
} from './harness.ts';
import type { Captured } from './harness.ts';

const ajv = createAjv();
const validReport = validator(ajv, 'run-report.schema.json');
const validOutcome = validator(ajv, 'outcome.schema.json');
const REPORTS = 'reports/pw-perf';

let root: string;
beforeEach(() => {
  root = tempDir();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A project directory under the temporary root, with a Playwright config file. */
function projectDir(name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'playwright.config.ts'), 'export default {};\n');
  return dir;
}

interface ShardRun {
  dir: string;
  captured: Captured;
  outcome: Outcome;
  file: ShardFile | null;
  status: { status?: string } | undefined;
}

function readOutcome(dir: string): Outcome {
  const path = join(dir, REPORTS, 'outcome.json');
  const text = readFileSync(path, 'utf8');
  expect(validOutcome(JSON.parse(text)), JSON.stringify(validOutcome.errors)).toBe(true);
  const parsed = parseOutcome(text, path);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
}

function readReport(dir: string): RunReport {
  const text = readFileSync(join(dir, REPORTS, 'report.json'), 'utf8');
  expect(validReport(JSON.parse(text)), JSON.stringify(validReport.errors)).toBe(true);
  const parsed = parseRunReport(text, 'report.json');
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
}

/** Tests of one shard: `count` tests, each calling `paths` with `ms(i, path)`. */
interface ShardTests {
  count: number;
  paths: string[];
  ms: (i: number, path: string) => number;
  file?: string;
}

async function runShard(
  name: string,
  shard: { current: number; total: number },
  tests: ShardTests[],
  options: {
    config?: PerfConfigInput;
    mode?: 'test' | 'thresholds';
    status?: 'passed' | 'failed' | 'interrupted';
    host?: Partial<typeof HOST_INFO>;
    ci?: Captured['host']['ci'];
    start?: number;
    maxFailures?: number;
    failed?: number;
  } = {},
): Promise<ShardRun> {
  const dir = projectDir(name);
  const captured = fakeHost(dir, { start: options.start ?? Date.UTC(2026, 10, 27, 10, 0, 0) });
  captured.host.host = { ...HOST_INFO, ...options.host };
  captured.host.ci = options.ci ?? null;
  const s = session(captured, registered(options.config ?? {}, { mode: options.mode ?? 'test' }));
  s.begin(fakeConfig(dir, { shard, maxFailures: options.maxFailures ?? 0 }), {
    allTests: () => tests.flatMap((t) => Array.from({ length: t.count }, () => fakeTest(dir))),
  });
  let failed = options.failed ?? 0;
  for (const t of tests) {
    for (let i = 0; i < t.count; i++) {
      const outcome = failed > 0 ? 'unexpected' : 'expected';
      failed -= 1;
      const test = fakeTest(dir, {
        id: `${t.file ?? 'a'}-${String(i)}`,
        title: `${t.file ?? 'a'} test ${String(i)}`,
        file: `${t.file ?? 'a'}.spec.ts`,
        outcome,
      });
      s.testBegin();
      s.testEnd(test, result([batch(t.paths.map((p) => request(p, t.ms(i, p))))]));
    }
  }
  const status = await s.end({ status: options.status ?? 'passed' });
  const path = join(dir, REPORTS, shardFileName(shard));
  let file: ShardFile | null = null;
  if (existsSync(path)) {
    const parsed = parseShardFile(readFileSync(path, 'utf8'));
    if (!parsed.ok) throw new Error(parsed.reason);
    file = parsed.value;
  }
  return { dir, captured, outcome: readOutcome(dir), file, status };
}

/** Copies the shard files of `runs` to a new project directory and merges them there. */
async function merge(
  runs: readonly ShardRun[],
  options: { env?: Record<string, string>; config?: boolean; ci?: Captured['host']['ci'] } = {},
): Promise<{ dir: string; code: number; captured: Captured }> {
  const dir = options.config === false ? join(root, 'merge') : projectDir('merge');
  mkdirSync(join(dir, REPORTS), { recursive: true });
  for (const run of runs) {
    if (run.file === null) continue;
    const name = shardFileName(run.file.shard);
    cpSync(join(run.dir, REPORTS, name), join(dir, REPORTS, name));
  }
  const captured = fakeHost(dir, { env: options.env ?? {} });
  captured.host.ci = options.ci ?? null;
  const code = await runMerge(captured.host, '0.0.0-test');
  return { dir, code, captured };
}

const steady =
  (base: number) =>
  (i: number): number =>
    base + (i % 5);

const A: ShardTests = { count: 6, paths: ['/api/a', '/api/shared'], ms: steady(50), file: 'a' };
const B: ShardTests = { count: 6, paths: ['/api/b', '/api/shared'], ms: steady(80), file: 'b' };

const codes = (issues: readonly { code: string }[]): string[] => issues.map((i) => i.code);

describe('a shard run (17, chapter 5)', () => {
  test('17-AC-01 17-AC-08 a shard writes its shard file and outcome 0, no report and no RUN_SHARDED', async () => {
    const run = await runShard('s1', { current: 1, total: 2 }, [A]);
    expect(run.outcome.exitCode).toBe(0);
    expect(run.outcome.evaluation).toEqual({ status: 'passed', gateEnabled: false });
    expect(run.outcome.paths).toEqual({
      reportJson: null,
      reportHtml: null,
      thresholds: [],
      thresholdsDiff: null,
    });
    expect(run.status).toBeUndefined();
    expect(existsSync(join(run.dir, REPORTS, 'report.json'))).toBe(false);
    expect(existsSync(join(run.dir, REPORTS, 'junit.xml'))).toBe(false);
    expect(existsSync(join(run.dir, 'pw-perf-thresholds.json'))).toBe(false);
    const file = run.file as ShardFile;
    expect(file.shard).toEqual({ current: 1, total: 2 });
    expect(file.mode).toBe('test');
    expect(file.paths).toEqual({
      configDir: '.',
      configFile: 'playwright.config.ts',
      reportDir: REPORTS,
    });
    expect(file.entries.filter((e) => e[0] === 'r')).toHaveLength(12);
    expect(file.tests).toEqual({ expected: 6, unexpected: 0, flaky: 0, skipped: 0 });
    const out = run.captured.stdout.join('');
    expect(out).toContain('pw-perf · measurement run · shard 1/2');
    expect(out).toContain(`Report   │ ${REPORTS}/shard-1-of-2.json`);
    expect(out).toContain('pw-perf · shard 1/2 done');
    expect(out).toContain('│ Tests   │ 6 tests × 1 pass = 6 test runs');
    expect(out).toContain('│ Samples │ 12 (api 12 · step 0)');
    expect(out).toContain(
      'Outcome: Playwright exit code 0 · details: shard data written (code 0) in',
    );
    expect(out).toContain(
      'Next: when all 2 shards are done, run PW_PERF_MODE=merge npx pw-perf in the merge job',
    );
    expect(out).not.toContain('RUN_SHARDED');
  });

  test('17-AC-02 a shard without tests writes a shard file with empty entries', async () => {
    const run = await runShard('s3', { current: 3, total: 3 }, []);
    expect(run.file?.entries).toEqual([]);
    expect(run.file?.counters.testsStarted).toBe(0);
    expect(run.outcome.exitCode).toBe(0);
  });

  test('17-AC-02 an empty shard as Playwright reports it (no project suites) has no tool error', async () => {
    const dir = projectDir('empty-suites');
    const captured = fakeHost(dir);
    const s = session(captured, registered({}, { mode: 'test' }));
    s.begin(fakeConfig(dir, { shard: { current: 3, total: 3 } }), {
      allTests: () => [],
      suites: [],
    });
    await s.end({ status: 'passed' });
    const out = captured.stdout.join('');
    expect(out).not.toContain('CONFIG_NO_MEASURED_PROJECT');
    expect(out).toContain('shard data written (code 0)');
  });

  test('an interrupted shard: shard data incomplete, exit code 3, the file is written', async () => {
    const run = await runShard('s1', { current: 1, total: 2 }, [A], { status: 'interrupted' });
    expect(run.outcome.exitCode).toBe(3);
    expect(codes(run.outcome.toolErrors)).toEqual(['RUN_INCOMPLETE']);
    expect(run.file?.status).toBe('interrupted');
    // The merge decides RUN_INCOMPLETE from the status; it is not in the file.
    expect(codes(run.file?.toolErrors ?? [])).toEqual([]);
    expect(run.captured.stdout.join('')).toContain('details: shard data incomplete (code 3)');
    expect(run.status).toEqual({ status: 'failed' });
  });

  test('SHARD_WRITE_FAILED when report.dir cannot be written', async () => {
    const dir = projectDir('blocked');
    // A file where the report folder should be.
    writeFileSync(join(dir, 'reports'), '');
    const captured = fakeHost(dir);
    const s = session(captured, registered({}, { mode: 'test' }));
    s.begin(fakeConfig(dir, { shard: { current: 1, total: 2 } }), { allTests: () => [] });
    runTests(s, dir, 2, ['/api/a'], () => 50);
    expect(await s.end({ status: 'passed' })).toEqual({ status: 'failed' });
    expect(captured.stdout.join('')).toContain('SHARD_WRITE_FAILED');
  });

  test('17-AC-08 check with --shard checks the tests of the shard, without a shard file', async () => {
    const dir = projectDir('check');
    const captured = fakeHost(dir);
    const s = session(captured, registered({}, { mode: 'check', runId: 'check-1' }));
    s.begin(fakeConfig(dir, { shard: { current: 2, total: 4 } }), {
      allTests: () => [fakeTest(dir)],
    });
    runTests(s, dir, 1, ['/api/a'], () => 50);
    expect(await s.end({ status: 'passed' })).toBeUndefined();
    const out = captured.stdout.join('');
    expect(out).toContain('pw-perf · check (dry run) · shard 2/4');
    expect(out).toContain('pw-perf · check · shard 2/4 · 1 of 1 test run');
    expect(out).toContain('only the tests of this shard were checked');
    expect(out).not.toContain('RUN_SHARDED');
    expect(existsSync(join(dir, REPORTS, 'shard-2-of-4.json'))).toBe(false);
  });

  test('17-REQ-25 the start banner of a run estimated above 2 hours suggests --shard', () => {
    const input = {
      packageName: 'pw-perf',
      mode: 'test' as const,
      measured: ['chromium'],
      dependencies: [],
      tests: 400,
      passes: 5,
      estimate: '≈ 6h 40m (from the last run)',
      report: 'reports/pw-perf/report.html',
      tip: true,
    };
    const opts = { width: 160, color: false, ascii: false };
    expect(formatStartBanner({ ...input, long: true }, opts)).toContain(
      'Tip      │ measure a subset, e.g. --grep @perf, or split it across machines with --shard (docs/ci.md)',
    );
    expect(formatStartBanner(input, opts)).not.toContain('--shard');
    expect(formatStartBanner({ ...input, tip: false, long: true }, opts)).toContain(
      'Tip      │ split it across machines with --shard (docs/ci.md)',
    );
  });
});

describe('the shard merge (17, chapter 7)', () => {
  test('17-AC-03 merging two shards gives the endpoints, evaluation and tests of one process with the same results', async () => {
    // Without cold samples: a key called in both shards has one cold sample per shard (17-AC-11).
    const config: PerfConfigInput = { measure: { coldSamples: 0 } };
    const s1 = await runShard('s1', { current: 1, total: 2 }, [A], { config });
    const s2 = await runShard('s2', { current: 2, total: 2 }, [B], { config });
    const merged = await merge([s1, s2]);
    expect(merged.code).toBe(0);
    const report = readReport(merged.dir);

    const single = projectDir('single');
    const captured = fakeHost(single);
    const s = session(captured, registered(config, { mode: 'test' }));
    s.begin(fakeConfig(single), { allTests: () => [] });
    for (const t of [A, B]) {
      for (let i = 0; i < t.count; i++) {
        s.testBegin();
        s.testEnd(
          fakeTest(single, {
            id: `${t.file ?? ''}-${String(i)}`,
            title: `${t.file ?? ''} test ${String(i)}`,
            file: `${t.file ?? ''}.spec.ts`,
          }),
          result([batch(t.paths.map((p) => request(p, t.ms(i, p))))]),
        );
      }
    }
    await s.end({ status: 'passed' });
    const one = readReport(single);
    expect(report.endpoints).toEqual(one.endpoints);
    expect(report.steps).toEqual(one.steps);
    expect(report.evaluation).toEqual(one.evaluation);
    expect(report.tests).toEqual(one.tests);
    expect(report.shards?.total).toBe(2);
    expect(one.shards).toBeNull();
  });

  test('17-AC-11 08-AC-26 a key called in both shards has one cold sample per shard', async () => {
    const s1 = await runShard('s1', { current: 1, total: 2 }, [
      { ...A, ms: (i, p) => (i === 0 && p === '/api/shared' ? 900 : 50 + (i % 5)) },
    ]);
    const s2 = await runShard('s2', { current: 2, total: 2 }, [
      { ...B, ms: (i, p) => (i === 0 && p === '/api/shared' ? 700 : 80 + (i % 5)) },
    ]);
    const merged = await merge([s1, s2]);
    const report = readReport(merged.dir);
    const cold = report.endpoints['GET /api/shared']?.cold;
    expect(cold?.count).toBe(2);
    expect(cold?.excluded).toBe(true);
    // In the order of the shard numbers.
    expect(cold?.durations).toEqual([900, 700]);
    expect(report.endpoints['GET /api/shared']?.successCount).toBe(10);
    expect(report.endpoints['GET /api/a']?.cold?.count).toBe(1);
    expect(report.endpoints['GET /api/b']?.cold?.count).toBe(1);
  });

  test('17-AC-04 17-REQ-16 17-REQ-17 17-REQ-19 the merged report: shards, times, host, passes and exit code 2 for a slow key', async () => {
    // Thresholds from a merged thresholds run, then a slower key in shard 1.
    const t1 = await runShard('t1', { current: 1, total: 2 }, [A], { mode: 'thresholds' });
    const t2 = await runShard('t2', { current: 2, total: 2 }, [B], { mode: 'thresholds' });
    const thresholds = await merge([t1, t2]);
    expect(thresholds.code).toBe(0);
    expect(existsSync(join(thresholds.dir, 'pw-perf-thresholds.json'))).toBe(true);

    const slow = { ...A, ms: (i: number, p: string) => (p === '/api/a' ? 400 : 50) + (i % 5) };
    const s1 = await runShard('s1', { current: 1, total: 2 }, [slow], {
      ci: { provider: 'github', commit: 'abc1234def', branch: 'main', buildUrl: 'https://ci/1' },
      start: Date.UTC(2026, 10, 27, 9, 0, 0),
    });
    const s2 = await runShard('s2', { current: 2, total: 2 }, [B], {
      host: { cpuModel: 'Other CPU' },
      start: Date.UTC(2026, 10, 27, 11, 0, 0),
    });
    // The merge job's checkout has the thresholds files: the same folder as the thresholds merge.
    const merged = await merge([s1, s2], {
      ci: { provider: 'github', commit: 'abc1234def', branch: 'main', buildUrl: 'https://ci/9' },
    });
    expect(merged.code).toBe(2);
    expect(readOutcome(merged.dir).exitCode).toBe(2);
    const report = readReport(merged.dir);
    expect(report.endpoints['GET /api/a']?.evaluation.result).toBe('fail');
    expect(report.shards).toEqual({
      total: 2,
      missing: [],
      list: [
        expect.objectContaining({
          index: 1,
          runId: s1.file?.runId,
          status: 'passed',
          samples: 12,
          buildUrl: 'https://ci/1',
          passes: { planned: 1, completed: 1, failed: [] },
          tests: { status: 'passed', expected: 6, unexpected: 0, flaky: 0, skipped: 0 },
        }),
        expect.objectContaining({
          index: 2,
          buildUrl: null,
          host: { ...HOST_INFO, cpuModel: 'Other CPU' },
        }),
      ],
    });
    expect(report.runId).not.toBe(s1.file?.runId);
    expect(report.startedAt).toBe(s1.file?.startedAt);
    expect(report.finishedAt).toBe(s2.file?.finishedAt);
    expect(report.host.cpuModel).toBe('Test CPU');
    expect(report.ci?.buildUrl).toBe('https://ci/9');
    expect(report.configDir).toBe(merged.dir);
    expect(report.tests).toEqual({
      status: 'passed',
      expected: 12,
      unexpected: 0,
      flaky: 0,
      skipped: 0,
    });
    expect(codes(report.warnings)).toContain('MERGE_SHARDS_DIFFERENT_HOSTS');
    const html = readFileSync(join(merged.dir, REPORTS, 'report.html'), 'utf8');
    expect(html).toContain('merged from <b>2 shards</b>');
    expect(html).toContain('<h3 id="shards-h">Shards</h3>');
    const junit = readFileSync(join(merged.dir, REPORTS, 'junit.xml'), 'utf8');
    expect(junit).toContain('<property name="pw-perf.shards" value="2"/>');
    expect(junit).toContain('<failure');
    const out = merged.captured.stdout.join('');
    expect(out).toContain('mode: test · merged from 2 shards');
    // Different machines: the table of shards before the verdict (17-REQ-19).
    expect(out).toMatch(/│ shard │ tests │ samples │/u);
    expect(out).toContain('Outcome: performance failed (code 2) in');
    expect(out).not.toContain('Playwright exit code');
    // The merge does not know the shard command: the thresholds run of the shard jobs (17-REQ-19).
    expect(out).toContain(
      'derive thresholds again: PW_PERF_MODE=thresholds in the shard jobs, then PW_PERF_MODE=merge npx pw-perf',
    );
    expect(out).not.toContain('npx playwright test');
  });

  test('17-AC-05 a merged thresholds run writes the keys of both shards; a missing shard writes none', async () => {
    const t1 = await runShard('t1', { current: 1, total: 2 }, [A], { mode: 'thresholds' });
    const t2 = await runShard('t2', { current: 2, total: 2 }, [B], { mode: 'thresholds' });
    const complete = await merge([t1, t2]);
    expect(complete.code).toBe(0);
    const file = JSON.parse(
      readFileSync(join(complete.dir, 'pw-perf-thresholds.json'), 'utf8'),
    ) as { entries: Record<string, unknown> };
    expect(Object.keys(file.entries).sort()).toEqual([
      'GET /api/a',
      'GET /api/b',
      'GET /api/shared',
    ]);
    expect(existsSync(join(complete.dir, REPORTS, 'thresholds-diff.md'))).toBe(true);
    rmSync(complete.dir, { recursive: true, force: true });

    const partial = await merge([t1]);
    expect(partial.code).toBe(3);
    expect(existsSync(join(partial.dir, 'pw-perf-thresholds.json'))).toBe(false);
    const report = readReport(partial.dir);
    expect(codes(report.toolErrors)).toContain('MERGE_SHARD_MISSING');
    expect(report.shards?.missing).toEqual([2]);
    const out = partial.captured.stdout.join('');
    expect(out).toContain('merged from 1 of 2 shards');
    expect(out).toMatch(/│ 2\/2 +│/u);
    const html = readFileSync(join(partial.dir, REPORTS, 'report.html'), 'utf8');
    expect(html).toContain('<span class="chip warn">');
  });

  test('17-REQ-15 RUN_INCOMPLETE from an interrupted shard and from maxFailures per shard', async () => {
    const s1 = await runShard('s1', { current: 1, total: 2 }, [A], { status: 'interrupted' });
    const s2 = await runShard('s2', { current: 2, total: 2 }, [B]);
    const merged = await merge([s1, s2]);
    expect(merged.code).toBe(3);
    expect(readReport(merged.dir).tests.status).toBe('interrupted');
    expect(codes(readReport(merged.dir).toolErrors)).toContain('RUN_INCOMPLETE');
    rmSync(merged.dir, { recursive: true, force: true });

    // maxFailures 2 per shard: shard 1 stopped after 2 failures, shard 2 had none.
    const f1 = await runShard('f1', { current: 1, total: 2 }, [A], {
      maxFailures: 2,
      failed: 2,
      status: 'failed',
    });
    const f2 = await runShard('f2', { current: 2, total: 2 }, [B], { maxFailures: 2 });
    const stopped = await merge([f1, f2]);
    const issue = readReport(stopped.dir).toolErrors.find((i) => i.code === 'RUN_INCOMPLETE');
    expect(issue?.message).toMatch(/^Shard 1\/2: .*maxFailures 2/u);
  });

  test('17-REQ-18 PW_PERF_PRUNE of the shards prunes after the merge', async () => {
    const t1 = await runShard('t1', { current: 1, total: 2 }, [A], { mode: 'thresholds' });
    const t2 = await runShard('t2', { current: 2, total: 2 }, [B], { mode: 'thresholds' });
    const first = await merge([t1, t2]);
    const thresholds = readFileSync(join(first.dir, 'pw-perf-thresholds.json'), 'utf8');
    rmSync(first.dir, { recursive: true, force: true });
    // No shard calls GET /api/shared any more: PW_PERF_PRUNE removes it after the merge.
    const dir = projectDir('merge');
    writeFileSync(join(dir, 'pw-perf-thresholds.json'), thresholds);
    const p1 = await runShard('p1', { current: 1, total: 2 }, [{ ...A, paths: ['/api/a'] }], {
      mode: 'thresholds',
    });
    const p2 = await runShard('p2', { current: 2, total: 2 }, [{ ...B, paths: ['/api/b'] }], {
      mode: 'thresholds',
    });
    for (const run of [p1, p2]) {
      const path = join(
        run.dir,
        REPORTS,
        shardFileName(run.file?.shard ?? { current: 1, total: 2 }),
      );
      const file = JSON.parse(readFileSync(path, 'utf8')) as ShardFile;
      writeFileSync(path, JSON.stringify({ ...file, prune: true }));
      run.file = { ...file, prune: true };
    }
    const merged = await merge([p1, p2]);
    expect(merged.code).toBe(0);
    const after = JSON.parse(readFileSync(join(dir, 'pw-perf-thresholds.json'), 'utf8')) as {
      entries: Record<string, unknown>;
    };
    expect(Object.keys(after.entries).sort()).toEqual(['GET /api/a', 'GET /api/b']);
  });
});

describe('17-AC-06 the validation of the shard set (17-REQ-14)', () => {
  async function pair(): Promise<[ShardRun, ShardRun]> {
    return [
      await runShard('s1', { current: 1, total: 2 }, [A]),
      await runShard('s2', { current: 2, total: 2 }, [B]),
    ];
  }

  test('no shard files: MERGE_NO_SHARD_FILES, no report and no outcome.json, exit code 3', async () => {
    const merged = await merge([]);
    expect(merged.code).toBe(3);
    expect(merged.captured.stderr.join('')).toContain('MERGE_NO_SHARD_FILES');
    expect(existsSync(join(merged.dir, REPORTS, 'outcome.json'))).toBe(false);
    expect(existsSync(join(merged.dir, REPORTS, 'report.json'))).toBe(false);
  });

  test('a broken file: MERGE_SHARD_INVALID with its name, the file is skipped', async () => {
    const [s1, s2] = await pair();
    const dir = projectDir('merge');
    mkdirSync(join(dir, REPORTS), { recursive: true });
    writeFileSync(join(dir, REPORTS, 'shard-3-of-2.json'), '{ not json');
    const merged = await merge([s1, s2]);
    expect(merged.code).toBe(3);
    const report = readReport(merged.dir);
    const invalid = report.toolErrors.find((i) => i.code === 'MERGE_SHARD_INVALID');
    expect(invalid?.message).toContain('shard-3-of-2.json');
    expect(report.shards?.list.map((s) => s.index)).toEqual([1, 2]);
  });

  test('another format version: MERGE_SHARD_INVALID', () => {
    const set = validateShardSet({
      files: [
        {
          name: 'shard-1-of-1.json',
          text: JSON.stringify({ format: 'pw-perf-shard', schemaVersion: 9 }),
        },
      ],
      env: {},
      configFound: () => true,
    });
    expect(set.kind).toBe('fatal');
    expect(codes(set.toolErrors)).toEqual(['MERGE_SHARD_INVALID']);
  });

  test.each([
    ['toolVersion', (f: ShardFile) => ({ ...f, toolVersion: '9.9.9' })],
    ['playwrightVersion', (f: ShardFile) => ({ ...f, playwrightVersion: '1.99.0' })],
    ['mode', (f: ShardFile) => ({ ...f, mode: 'thresholds' })],
    ['env', (f: ShardFile) => ({ ...f, env: 'staging' })],
    ['total', (f: ShardFile) => ({ ...f, shard: { current: 2, total: 3 } })],
    [
      'config',
      (f: ShardFile) => ({
        ...f,
        config: { ...f.config, report: { ...f.config.report, html: false } },
      }),
    ],
    ['normalization', (f: ShardFile) => ({ ...f, normalization: '00000000000000' })],
    ['stepNormalization', (f: ShardFile) => ({ ...f, stepNormalization: null })],
    ['paths', (f: ShardFile) => ({ ...f, paths: { ...f.paths, configDir: 'e2e' } })],
  ])(
    'different %s: MERGE_SHARD_MISMATCH, no report, outcome.json with exit code 3',
    async (field, change) => {
      const [s1, s2] = await pair();
      const path = join(s2.dir, REPORTS, 'shard-2-of-2.json');
      writeFileSync(path, JSON.stringify(change(s2.file as ShardFile)));
      const merged = await merge([s1, s2]);
      expect(merged.code).toBe(3);
      expect(existsSync(join(merged.dir, REPORTS, 'report.json'))).toBe(false);
      const outcome = readOutcome(merged.dir);
      expect(outcome.mode).toBe('test');
      expect(codes(outcome.toolErrors)).toEqual(['MERGE_SHARD_MISMATCH']);
      expect(outcome.toolErrors[0]?.message).toContain(`(${field})`);
    },
  );

  test('two files of one shard: MERGE_SHARD_DUPLICATE, no report, exit code 3', async () => {
    const [s1] = await pair();
    const duplicate = validateShardSet({
      files: [
        { name: 'shard-1-of-2.json', text: JSON.stringify(s1.file) },
        { name: 'shard-2-of-2.json', text: JSON.stringify(s1.file) },
      ],
      env: {},
      configFound: () => true,
    });
    expect(duplicate.kind).toBe('fatal');
    expect(codes(duplicate.toolErrors)).toEqual(['MERGE_SHARD_DUPLICATE']);
    expect(duplicate.toolErrors[0]?.message).toBe(
      'Shard 1 has more than one file: shard-1-of-2.json, shard-2-of-2.json.',
    );
  });

  test('a missing shard: MERGE_SHARD_MISSING, report of the others, no thresholds files, exit code 3', async () => {
    const [s1] = await pair();
    const merged = await merge([s1]);
    expect(merged.code).toBe(3);
    const report = readReport(merged.dir);
    expect(report.toolErrors.find((i) => i.code === 'MERGE_SHARD_MISSING')?.message).toBe(
      'Shard 2/2 is missing; the report covers the other shards only.',
    );
    expect(report.shards?.missing).toEqual([2]);
  });

  test('shards of different commits: MERGE_SHARDS_DIFFERENT_COMMIT, the merge goes on', async () => {
    const ci = (commit: string): Captured['host']['ci'] => ({
      provider: 'github',
      commit,
      branch: 'main',
      buildUrl: null,
    });
    const s1 = await runShard('s1', { current: 1, total: 2 }, [A], { ci: ci('aaaaaaa111') });
    const s2 = await runShard('s2', { current: 2, total: 2 }, [B], { ci: ci('bbbbbbb222') });
    const merged = await merge([s1, s2]);
    expect(merged.code).toBe(0);
    expect(codes(readReport(merged.dir).warnings)).toContain('MERGE_SHARDS_DIFFERENT_COMMIT');
  });

  test('different machines: MERGE_SHARDS_DIFFERENT_HOSTS; another Node version is the same machine', async () => {
    const s1 = await runShard('s1', { current: 1, total: 2 }, [A], {
      host: { nodeVersion: 'v24.0.0' },
    });
    const s2 = await runShard('s2', { current: 2, total: 2 }, [B]);
    const same = await merge([s1, s2]);
    expect(codes(readReport(same.dir).warnings)).not.toContain('MERGE_SHARDS_DIFFERENT_HOSTS');
    rmSync(same.dir, { recursive: true, force: true });
    const s3 = await runShard('s3', { current: 2, total: 2 }, [B], { host: { cpuCount: 16 } });
    const different = await merge([s1, s3]);
    const warning = readReport(different.dir).warnings.find(
      (w) => w.code === 'MERGE_SHARDS_DIFFERENT_HOSTS',
    );
    expect(warning?.message).toContain('2 different kinds of machines');
  });

  test('another directory: MERGE_WRONG_DIRECTORY, no report, exit code 3', async () => {
    const [s1, s2] = await pair();
    const merged = await merge([s1, s2], { config: false });
    expect(merged.code).toBe(3);
    expect(existsSync(join(merged.dir, REPORTS, 'report.json'))).toBe(false);
    expect(codes(readOutcome(merged.dir).toolErrors)).toEqual(['MERGE_WRONG_DIRECTORY']);
  });

  test('PW_PERF_ENV, PW_PERF_PRUNE and PW_PERF_PASSES of the merge job: MERGE_ENV_IGNORED', async () => {
    const [s1, s2] = await pair();
    const merged = await merge([s1, s2], {
      env: { PW_PERF_ENV: 'staging', PW_PERF_PRUNE: '1', PW_PERF_PASSES: '1' },
    });
    const report = readReport(merged.dir);
    expect(report.env).toBeNull();
    const warning = report.warnings.find((w) => w.code === 'MERGE_ENV_IGNORED');
    // PW_PERF_PASSES=1 is the value of the shard files.
    expect(warning?.message).toBe(
      'PW_PERF_ENV=staging, PW_PERF_PRUNE=1 were ignored: the merge uses the values of the shard files.',
    );
  });

  test('17-REQ-16 equal beginWarnings of several shards are kept once', async () => {
    const config: PerfConfigInput = {};
    const s1 = await runShard('s1', { current: 1, total: 2 }, [A], { config });
    const s2 = await runShard('s2', { current: 2, total: 2 }, [B], { config });
    const warning = { code: 'RUN_CONDITIONS_CHANGED', message: 'same', hint: 'h' };
    for (const run of [s1, s2]) {
      const path = join(
        run.dir,
        REPORTS,
        shardFileName(run.file?.shard ?? { current: 1, total: 2 }),
      );
      writeFileSync(path, JSON.stringify({ ...(run.file as ShardFile), beginWarnings: [warning] }));
    }
    const merged = await merge([s1, s2]);
    const report = readReport(merged.dir);
    expect(report.warnings.filter((w) => w.message === 'same')).toHaveLength(1);
  });
});
