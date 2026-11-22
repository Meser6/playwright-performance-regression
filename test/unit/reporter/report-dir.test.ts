// Emptying report.dir at the start of a run and its guard (04-REQ-71).
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, parse, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { PerfConfigInput } from '../../../src/core/config/index.ts';
import type { Issue, RunReport } from '../../../src/core/types/index.ts';
import * as io from '../../../src/io/index.ts';
import type { PerfModeState } from '../../../src/mode/index.ts';
import { cleanReportDir } from '../../../src/reporter/report-dir.ts';
import type { ReporterHost } from '../../../src/reporter/types.ts';
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

const RESULTS = 'reports/pw-perf';

/** A report.dir with files of an earlier run. */
function earlierRun(results = join(dir, RESULTS)): string {
  mkdirSync(join(results, 'old', 'nested'), { recursive: true });
  writeFileSync(join(results, 'report.html'), 'old report');
  writeFileSync(join(results, 'thresholds-diff.md'), 'old diff');
  writeFileSync(join(results, 'old', 'nested', 'file.txt'), 'old');
  return results;
}

/** Starts a run (onBegin and the first test) and returns its session and warnings. */
function start(
  input: PerfConfigInput = {},
  mode: PerfModeState = { mode: 'test' },
  host: Partial<ReporterHost> = {},
): { warnings: () => Issue[]; end: () => Promise<RunReport> } {
  const captured = fakeHost(dir);
  Object.assign(captured.host, host);
  const s = session(captured, registered(input, mode));
  s.begin(fakeConfig(dir), { allTests: () => [] });
  s.testBegin();
  s.testEnd(fakeTest(dir), result([batch([request('/api/cart', 50)])]));
  return {
    warnings: () => {
      const all = (s as unknown as { warnings: Issue[] }).warnings;
      return all.filter((w) => w.code === 'RUN_REPORT_DIR_NOT_CLEANED');
    },
    end: async () => {
      await s.end({ status: 'passed' });
      const reportDir = join(dir, input.report?.dir ?? RESULTS);
      return JSON.parse(readFileSync(join(reportDir, 'report.json'), 'utf8')) as RunReport;
    },
  };
}

describe('04-REQ-71 emptying report.dir', () => {
  test('04-AC-50 the first test of a run empties report.dir; links are removed, not followed', async () => {
    const results = earlierRun();
    const outside = join(dir, 'outside.txt');
    writeFileSync(outside, 'keep me');
    symlinkSync(outside, join(results, 'link.txt'));
    const run = start();
    expect(readdirSync(results)).toEqual([]);
    expect(readFileSync(outside, 'utf8')).toBe('keep me');
    const report = await run.end();
    expect(report.warnings.map((w) => w.code)).not.toContain('RUN_REPORT_DIR_NOT_CLEANED');
    expect(readdirSync(results).sort()).toEqual(['outcome.json', 'report.html', 'report.json']);
    expect(readFileSync(join(results, 'report.html'), 'utf8')).not.toBe('old report');
  });

  test('04-AC-50 D-47 only reports/pw-perf is emptied, never its parent reports/', async () => {
    const results = earlierRun();
    const reports = join(dir, 'reports');
    writeFileSync(join(reports, 'other.html'), 'another tool');
    mkdirSync(join(reports, 'other-tool'));
    writeFileSync(join(reports, 'other-tool', 'index.html'), 'another tool');
    const run = start();
    expect(readdirSync(results)).toEqual([]);
    await run.end();
    expect(readdirSync(reports).sort()).toEqual(['other-tool', 'other.html', 'pw-perf']);
    expect(readFileSync(join(reports, 'other.html'), 'utf8')).toBe('another tool');
    expect(readFileSync(join(reports, 'other-tool', 'index.html'), 'utf8')).toBe('another tool');
  });

  test('D-47 a missing reports/ parent is created when the report is written', async () => {
    const run = start();
    expect(existsSync(join(dir, 'reports'))).toBe(false);
    await run.end();
    expect(readdirSync(join(dir, RESULTS)).sort()).toEqual([
      'outcome.json',
      'report.html',
      'report.json',
    ]);
  });

  test('04-AC-50 a thresholds run empties report.dir too', () => {
    const results = earlierRun();
    start({}, { mode: 'thresholds' });
    expect(readdirSync(results)).toEqual([]);
  });

  test('04-AC-50 a run without a started test, a check and a later pass remove nothing', () => {
    const results = earlierRun();
    const before = readdirSync(results).sort();
    const captured = fakeHost(dir);
    const listed = session(captured, registered({}, { mode: 'test' }));
    listed.begin(fakeConfig(dir), { allTests: () => [] });
    expect(readdirSync(results).sort()).toEqual(before);

    start({}, { mode: 'check', runId: 'check-1' });
    expect(readdirSync(results).sort()).toEqual(before);

    start(
      { run: { passes: { test: 3 } } },
      { mode: 'test', runId: 'r', pass: { index: 2, total: 3 } },
    );
    expect(readdirSync(results).sort()).toEqual(before);
  });

  test('04-AC-50 the estimate reads the last report before it is removed', async () => {
    await start().end();
    const results = join(dir, RESULTS);
    expect(existsSync(join(results, 'report.json'))).toBe(true);
    const captured = fakeHost(dir);
    const s = session(captured, registered({}, { mode: 'test' }));
    s.begin(fakeConfig(dir), { allTests: () => [fakeTest(dir)] });
    s.testBegin();
    expect(captured.stdout.join('')).toContain('(from the last run)');
    expect(existsSync(join(results, 'report.json'))).toBe(false);
  });

  test('04-AC-50 a missing report.dir is neither checked nor created', () => {
    const run = start({ report: { dir: 'not-yet' } });
    expect(run.warnings()).toEqual([]);
    expect(existsSync(join(dir, 'not-yet'))).toBe(false);
  });
});

describe('04-REQ-71 guard', () => {
  const refused = (input: PerfConfigInput, host: Partial<ReporterHost> = {}): Issue[] =>
    start(input, { mode: 'test' }, host).warnings();

  test('04-AC-51 report.dir . or .. (the project and its ancestors) is not emptied', () => {
    writeFileSync(join(dir, 'keep.txt'), 'x');
    const [same] = refused({ report: { dir: '.' } });
    expect(same?.message).toBe(
      'report.dir . was not emptied at the start of the run: it is the project directory or contains it.',
    );
    expect(same?.hint).toContain('reports/pw-perf');
    expect(refused({ report: { dir: '..' } })).toHaveLength(1);
    expect(existsSync(join(dir, 'keep.txt'))).toBe(true);
  });

  test('04-AC-51 the config directory, rootDir, thresholds.dir, home and root are protected', () => {
    const app = join(dir, 'apps', 'web');
    mkdirSync(join(app, 'thresholds'), { recursive: true });
    writeFileSync(join(app, 'thresholds', 'keep.txt'), 'x');
    const host = { cwd: join(dir, 'apps') };
    const run = (input: PerfConfigInput): Issue[] => {
      const captured = fakeHost(dir);
      Object.assign(captured.host, host);
      const s = session(captured, registered(input, { mode: 'test' }));
      s.begin(fakeConfig(app), { allTests: () => [] });
      s.testBegin();
      return (s as unknown as { warnings: Issue[] }).warnings.filter(
        (w) => w.code === 'RUN_REPORT_DIR_NOT_CLEANED',
      );
    };
    // The project directory (cwd) is apps/, the config directory apps/web.
    expect(run({ report: { dir: '.' } })[0]?.message).toContain('Playwright config directory');
    expect(
      run({ report: { dir: 'thresholds' }, thresholds: { dir: 'thresholds' } })[0]?.message,
    ).toContain('it is the thresholds.dir or contains it');
    expect(run({ report: { dir: homedir() } })[0]?.message).toMatch(
      /it is the (home directory|project directory|Playwright config directory) or contains it/u,
    );
    expect(run({ report: { dir: parse(dir).root } })[0]?.message).toContain(
      'it is the filesystem root',
    );
    expect(existsSync(join(app, 'thresholds', 'keep.txt'))).toBe(true);
  });

  test('04-AC-51 a folder with a thresholds file, package.json, playwright.config or .git is not emptied', () => {
    for (const [file, reason] of [
      [
        'sub/pw-perf-thresholds.steps.qa.json',
        'contains a thresholds file (sub/pw-perf-thresholds.steps.qa.json)',
      ],
      ['pw-perf-thresholds.json', 'contains a thresholds file (pw-perf-thresholds.json)'],
      ['package.json', 'contains package.json, so it looks like a project folder'],
      ['a/playwright.config.ts', 'contains a/playwright.config.ts'],
      ['.git/HEAD', 'contains .git'],
    ] as const) {
      const results = join(dir, 'out');
      rmSync(results, { recursive: true, force: true });
      mkdirSync(join(results, file, '..'), { recursive: true });
      writeFileSync(join(results, file), '{}');
      const warnings = refused({ report: { dir: 'out' } });
      expect(warnings[0]?.message, file).toContain(reason);
      expect(existsSync(join(results, file))).toBe(true);
    }
  });

  test('04-AC-51 a link to the project directory is not emptied', () => {
    writeFileSync(join(dir, 'keep.txt'), 'x');
    const other = tempDir();
    try {
      const link = join(other, 'results');
      symlinkSync(dir, link, 'dir');
      expect(refused({ report: { dir: relative(dir, link) } })[0]?.message).toContain(
        'it is the project directory or contains it',
      );
      expect(existsSync(join(dir, 'keep.txt'))).toBe(true);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  test('04-AC-51 a failed removal is a warning and the run still writes its report', async () => {
    earlierRun();
    const failing = {
      ...io,
      emptyDirSync: () => {
        throw new Error('EACCES: permission denied');
      },
    };
    const run = start({}, { mode: 'test' }, { io: failing });
    const report = await run.end();
    const warning = report.warnings.find((w) => w.code === 'RUN_REPORT_DIR_NOT_CLEANED');
    expect(warning?.message).toBe(
      'report.dir reports/pw-perf was not emptied at the start of the run: removing a file failed (EACCES: permission denied).',
    );
    expect(report.toolErrors).toEqual([]);
  });

  test('too many entries are refused without listing them all', () => {
    const scan = { ...io, scanDirSync: () => null };
    mkdirSync(join(dir, RESULTS), { recursive: true });
    const warning = cleanReportDir(scan, {
      reportDir: join(dir, RESULTS),
      shownPath: RESULTS,
      protectedDirs: [],
      thresholdsPrefix: 'pw-perf-thresholds',
    });
    expect(warning?.message).toContain('it has more than 10000 entries');
  });
});
