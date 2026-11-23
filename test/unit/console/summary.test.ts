import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  exceedance,
  formatSummary,
  overText,
  truncateMiddle,
} from '../../../src/console/summary.ts';
import { textWidth } from '../../../src/console/text.ts';
import { stringifyStable } from '../../../src/core/format/index.ts';
import { parseRunReport } from '../../../src/core/schema/index.ts';
import type { RunReport } from '../../../src/core/types/index.ts';
import { GOLDEN_DIR } from '../../contract/golden.ts';

// Golden console summaries (12-REQ-14): test/golden/console/<name>.json holds a run report,
// <name>.w<width>.txt the expected text without colors. GOLDEN_UPDATE=1 rewrites the text files
// (12-REQ-16); the diff must be reviewed.
const DIR = join(GOLDEN_DIR, 'console');
const update = process.env['GOLDEN_UPDATE'] === '1';

function report(name: string): RunReport {
  const data = JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as { input: RunReport };
  return data.input;
}

const CASES: [string, number][] = [
  ...readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f): [string, number] => [f.slice(0, -'.json'.length), 120]),
  ['failed-run', 60],
];

function expectGolden(name: string, width: number): void {
  const text = formatSummary(report(name), { width, color: false });
  const file = join(DIR, `${name}.w${width}.txt`);
  if (update) {
    writeFileSync(file, text);
    return;
  }
  expect(existsSync(file), file).toBe(true);
  expect(text).toBe(readFileSync(file, 'utf8'));
}

describe('09-AC-36 table of the keys on default thresholds (09-REQ-37)', () => {
  /** failed-run with `count` more api keys on default thresholds; `fail` of them fail. */
  function withDefaults(count: number, fail: { blocking: boolean }[] = []): RunReport {
    const r = structuredClone(report('failed-run'));
    const base = r.endpoints['GET /api/users/:id'];
    if (base === undefined) throw new Error('no base key');
    for (let i = 0; i < count; i += 1) {
      const a = structuredClone(base);
      const f = fail[i];
      const median = a.evaluation.checks[0];
      if (f !== undefined && median !== undefined) {
        a.evaluation.result = 'fail';
        a.evaluation.checks = [{ ...median, actual: 2500, passed: false, blocking: f.blocking }];
      }
      r.endpoints[`GET /api/new-${String(i).padStart(2, '0')}`] = a;
    }
    return r;
  }
  const rowsOf = (text: string): string[] =>
    text
      .split('\n')
      .filter((l) => /^│ (✅|⚠|❌) +│ api +│ .*│ (pass|fail) +│$/u.test(l))
      .map((l) => l.replace(/\s*│\s*/gu, '|').replace(/^\||\|$/gu, ''));

  test('keys with a violation first, then passed ones, with n, median, percentile and limits', () => {
    const text = formatSummary(withDefaults(3, [{ blocking: false }, { blocking: true }]), {
      width: 120,
      color: false,
    });
    expect(text).toContain('On default thresholds (no entry in the thresholds file):');
    expect(rowsOf(text)).toEqual([
      '❌|api|GET /api/new-01|8|90 ms|90 ms|2000 / 2000 ms|fail',
      '⚠|api|GET /api/new-00|8|90 ms|90 ms|2000 / 2000 ms|fail',
      '✅|api|GET /api/new-02|8|90 ms|90 ms|2000 / 2000 ms|pass',
      '✅|api|GET /api/users/:id|8|90 ms|90 ms|2000 / 2000 ms|pass',
    ]);
    const header = text.split('\n').find((l) => l.includes('│ median │'));
    expect(header?.replace(/\s*│\s*/gu, '|')).toBe('||kind|key|n|median|p95|limit|result|');
  });

  test('at most 10 rows, then the "more" line', () => {
    const text = formatSummary(withDefaults(11), { width: 120, color: false });
    expect(rowsOf(text)).toHaveLength(10);
    expect(text).toContain('  … and 2 more keys on default thresholds (see report)');
    const dumb = formatSummary(withDefaults(1), { width: 120, color: false, ascii: true });
    expect(dumb).toContain('| ✔ | api  | GET /api/new-00');
  });

  test('no table in thresholds mode, with a missing file or a file without entries', () => {
    const title = 'On default thresholds';
    const thresholds = withDefaults(1);
    thresholds.mode = 'thresholds';
    expect(formatSummary(thresholds, { width: 120, color: false })).not.toContain(title);
    const missingFile = withDefaults(1);
    missingFile.thresholdFiles = missingFile.thresholdFiles.map((f) => ({
      ...f,
      status: 'missing' as const,
    }));
    expect(formatSummary(missingFile, { width: 120, color: false })).not.toContain(title);
    // No key from the file and no unseen entries: the file is empty (THRESHOLDS_FILE_EMPTY).
    const empty = withDefaults(1);
    empty.thresholdFiles = empty.thresholdFiles.map((f) => ({ ...f, unseenKeys: [] }));
    for (const a of Object.values(empty.endpoints)) a.evaluation.thresholdSource = 'default';
    expect(formatSummary(empty, { width: 120, color: false })).not.toContain(title);
  });
});

describe('console summary golden files', () => {
  test('golden reports are valid run reports', () => {
    for (const [name] of CASES) {
      expect(parseRunReport(stringifyStable(report(name)), name).ok, name).toBe(true);
    }
  });

  test('09-AC-08 the summary of a golden report equals its text file at width 120 without colors', () => {
    for (const [name, width] of CASES.filter(([, w]) => w === 120)) expectGolden(name, width);
  });

  test('09-AC-08 at width 60 long keys are shortened in the middle', () => {
    expectGolden('failed-run', 60);
    const text = formatSummary(report('failed-run'), { width: 60, color: false });
    const row = text.split('\n').find((l) => l.includes('lude&page&sort'));
    expect(row).toContain('│ GET /api/organi…lude&page&sort │');
  });

  test('09-AC-20 the over column follows Math.round((r - 1) * 100), >999%, and points for share rules', () => {
    const text = formatSummary(report('failed-run'), { width: 120, color: false });
    const rows = text.split('\n');
    const row = (key: string, rule: string) =>
      rows.find((l) => l.includes(` ${key} `) && l.includes(` ${rule} `)) ?? '';
    // errors: actual 0.1176 − limit 0.05 = 6.76 percentage points → +7 pp (09-D-20).
    expect(row('POST /api/orders', 'errors')).toMatch(/0\.118 \(0\.400\)[\s│]+0\.050[\s│]+\+7 pp/u);
    // apdex: limit − actual, in points.
    const search = report('failed-run').endpoints['GET /api/search']?.evaluation.checks;
    const apdex = search?.find((c) => c.rule === 'apdex');
    expect(apdex).toBeDefined();
    if (apdex !== undefined) {
      const over = Math.round((apdex.limit - apdex.actual) * 100);
      expect(row('GET /api/search', 'apdex')).toContain(`+${over} pp`);
    }
    // median 50 ms at limit 1 ms: +4900% is shown as >999%.
    expect(row('GET /api/health', 'median')).toContain('>999%');
    expect(row('GET /api/tickets/:id?search', 'p95')).toMatch(/1712 ms[\s│]+1400 ms[\s│]+\+22%/u);
  });

  test('09-AC-33 the FAILED verdict counts blocking violations (failed checks) and their keys', () => {
    const text = formatSummary(report('failed-run'), { width: 120, color: false });
    const blockingRows = text.split('\n').filter((l) => /^│ ❌ │ /u.test(l)).length;
    expect(text).toContain(`FAILED  ${String(blockingRows)} blocking violations in 5 keys`);
  });

  test('09-AC-20 over and exceedance edge cases', () => {
    expect(overText({ rule: 'errors', actual: 0.1176, limit: 0.05 })).toBe('+7 pp');
    expect(overText({ rule: 'wilson', actual: 0.839, limit: 0.03 })).toBe('+81 pp');
    expect(overText({ rule: 'apdex', actual: 0.7811, limit: 0.85 })).toBe('+7 pp');
    expect(overText({ rule: 'apdex', actual: 0, limit: 0.85 })).toBe('+85 pp');
    expect(overText({ rule: 'errors', actual: 0.001, limit: 0 })).toBe('+1 pp');
    expect(overText({ rule: 'median', actual: 1100, limit: 100 })).toBe('>999%');
    expect(overText({ rule: 'median', actual: 1099.4, limit: 100 })).toBe('+999%');
    // At least +1%: a violation never reads +0% (09-REQ-19, v5 item 10b).
    expect(overText({ rule: 'median', actual: 1400.1, limit: 1400 })).toBe('+1%');
    expect(exceedance({ rule: 'apdex', actual: 0, limit: 0.9 })).toBe(Infinity);
  });

  test('violations: blocking first, then by exceedance; at most 20 rows', () => {
    const text = formatSummary(report('failed-run'), { width: 120, color: false });
    const markers = text
      .split('\n')
      .filter((l) => /^│ (❌|⚠ ) │ api /u.test(l))
      .map((l) => l.slice(2, 3));
    expect(markers.indexOf('⚠')).toBeGreaterThan(markers.lastIndexOf('❌'));
    const many = formatSummary(report('thresholds-mode'), {
      width: 120,
      color: false,
    });
    expect(many.split('\n').filter((l) => /^│ ⚠ +│ api /u.test(l))).toHaveLength(20);
    expect(many).toContain('  … and 2 more violations (see report)');
    expect(many).toContain('│ … and 1 more warning (see report) ');
    expect(many).toContain('(informational, gate disabled)');
  });

  test('muted keys are listed and flagged MUTED', () => {
    const text = formatSummary(report('failed-run'), { width: 120, color: false });
    expect(text).toContain(
      'Muted: POST /api/reports/export until 2026-12-31 — "Depends on report service, tracked in backlog"',
    );
    const row = text
      .split('\n')
      .find((l) => l.includes('POST /api/reports/export') && l.startsWith('│ ⚠'));
    expect(row?.endsWith('│ MUTED │')).toBe(true);
  });

  test('09-AC-21 colors mark headings, codes, hints, rows and the verdict; without them the text is the same', () => {
    const ESC = String.fromCharCode(27);
    const plain = formatSummary(report('failed-run'), { width: 120, color: false });
    const colored = formatSummary(report('failed-run'), { width: 120, color: true });
    expect(plain).not.toContain(ESC);
    expect(colored.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'gu'), '')).toBe(plain);
    const lines = colored.split('\n');
    // Dim separator over the whole width, then the bold header.
    expect(lines[0]).toBe(`${ESC}[2m${'─'.repeat(120)}${ESC}[0m`);
    expect(lines[1]).toMatch(
      new RegExp(`^${ESC}\\[1mplaywright-performance-regression · mode: test`, 'u'),
    );
    // Boxes: yellow frame with a bold title for warnings, red for errors.
    expect(colored).toContain(`${ESC}[33m╭─ ${ESC}[0m${ESC}[1m⚠ Warnings (5)${ESC}[0m${ESC}[33m ─`);
    expect(colored).toContain(`${ESC}[1mMuted:${ESC}[0m`);
    expect(colored).toContain(`${ESC}[1mReport:${ESC}[0m`);
    expect(colored).toContain(`${ESC}[33m⚠ TESTS_FAILED${ESC}[0m: `);
    expect(colored).toContain(
      `${ESC}[2m  Hint: Fix the failing tests in your regular test run: a test that fails early records fewer samples.${ESC}[0m`,
    );
    // Tables: dim lines, bold head row, blocking rows red, non-blocking rows yellow.
    const head = lines.find((l) => l.includes('kind') && l.includes('flag')) ?? '';
    expect(head.startsWith(`${ESC}[2m│${ESC}[0m ${ESC}[1m`)).toBe(true);
    expect(colored).toContain(`${ESC}[1mEndpoints${ESC}[0m`);
    const row = (text: string) => lines.find((l) => l.includes(text)) ?? '';
    expect(row('GET /api/health')).toContain(
      `${ESC}[31m❌${ESC}[0m ${ESC}[2m│${ESC}[0m ${ESC}[31mapi `,
    );
    expect(row('2150 ms')).toContain(`${ESC}[33m⚠ ${ESC}[0m ${ESC}[2m│${ESC}[0m ${ESC}[33mapi `);
    // Verdict: a box in the verdict color with a badge on a colored background.
    expect(colored).toContain(`${ESC}[31m╭`);
    expect(colored).toContain(
      `❌ ${ESC}[1;97;41m FAILED ${ESC}[0m 9 blocking violations in 5 keys`,
    );
    const errors = formatSummary(report('tool-error'), { width: 120, color: true });
    expect(errors).toContain(`${ESC}[1m❌ Errors (1)${ESC}[0m`);
    expect(errors).toContain(`${ESC}[31m❌ SCHEMA_INVALID_JSON${ESC}[0m: `);
    expect(errors).toContain(`❌ ${ESC}[1;97;45m ERROR ${ESC}[0m `);
    expect(formatSummary(report('passed'), { width: 120, color: true })).toContain(
      `✅ ${ESC}[1;30;42m PASSED ${ESC}[0m `,
    );
    expect(formatSummary(report('thresholds-mode'), { width: 120, color: true })).toContain(
      `⚠ ${ESC}[1;30;43m PASSED WITH WARNINGS ${ESC}[0m `,
    );
  });

  test('09-AC-29 NO_COLOR keeps frames and emoji; TERM=dumb gives ASCII frames and text marks', () => {
    const plain = formatSummary(report('failed-run'), { width: 120, color: false });
    expect(plain).toContain('╭─ ⚠ Warnings (5) ─');
    expect(plain).toContain('│ ❌ │ api  │ GET /api/health');
    expect(plain).toContain('│ ❌  FAILED  9 blocking violations in 5 keys (tolerance: 0) │');
    const dumb = formatSummary(report('failed-run'), { width: 120, color: false, ascii: true });
    expect(dumb).toMatch(/^[\x20-\x7e✔✖!─·…—›\n]*$/u);
    expect(dumb).toContain('+- Warnings (5) -');
    expect(dumb).toContain('| ✖ | api  | GET /api/health');
    expect(dumb).toContain('| ! | api  | POST /api/reports/export');
    expect(dumb).toContain('| ✖  FAILED  9 blocking violations in 5 keys (tolerance: 0) |');
    // The same words in the same order: only frames and marks differ.
    const words = (text: string) =>
      text
        .replace(/[^A-Za-z0-9 ]+/gu, ' ')
        .split(/\s+/u)
        .join(' ');
    const wide = { width: 200, color: false };
    expect(words(formatSummary(report('failed-run'), { ...wide, ascii: true }))).toBe(
      words(formatSummary(report('failed-run'), wide)),
    );
  });

  test('09-AC-30 TESTS_FAILED says that the samples of failed tests are counted', () => {
    const text = formatSummary(report('failed-run'), { width: 120, color: false });
    expect(text).toContain('their samples are counted and the performance result still decides.');
    expect(text).not.toContain('Functional failures are reported');
  });

  test('frames close: every line of a box or table has the width of its top line', () => {
    for (const [name] of CASES) {
      for (const ascii of [false, true]) {
        const text = formatSummary(report(name), { width: 120, color: false, ascii });
        let width = -1;
        for (const line of text.split('\n')) {
          if (/^[╭┌+]/u.test(line)) width = textWidth(line);
          else if (/^[│|]/u.test(line)) expect(textWidth(line), `${name}: ${line}`).toBe(width);
        }
      }
    }
  });

  test('09-AC-22 ERROR names the cause: too many failed tests is not a tool error', () => {
    const text = formatSummary(report('tests-failed-too-many'), { width: 120, color: false });
    expect(text).toContain(
      '│ ❌  ERROR  too many failed tests (30 of 101 executions); the performance result is not trustworthy │\n',
    );
    expect(text).not.toContain('tool error');
    expect(formatSummary(report('tool-error'), { width: 120, color: false })).toContain(
      '│ ❌  ERROR  1 tool error; the performance result is not trustworthy │\n',
    );
    const both = report('tests-failed-too-many');
    both.toolErrors.push(
      { code: 'RUN_INCOMPLETE', message: 'The run timed out.' },
      { code: 'REPORT_WRITE_FAILED', message: 'x' },
    );
    expect(formatSummary(both, { width: 300, color: false })).toContain(
      '❌  ERROR  too many failed tests (30 of 101 executions), the run did not complete, 1 tool error; the performance result is not trustworthy',
    );
  });

  test('09-AC-24 the counter table has the keys row and only the non-zero counters', () => {
    const rows = (text: string) =>
      text
        .split('\n')
        .filter((l) => /^│ [a-z]/u.test(l) && !l.includes('│ api '))
        .map((l) => l.replace(/\s*│\s*/gu, '|').replace(/^\||\|$/gu, ''));
    expect(rows(formatSummary(report('passed'), { width: 120, color: false }))).toEqual([
      'keys|2',
      'from file|2',
      'checked by median only (few samples)|1',
    ]);
    expect(rows(formatSummary(report('failed-run'), { width: 120, color: false }))).toEqual([
      'keys|9',
      'from file|7',
      'on default thresholds|1',
      'skipped (too few samples)|1',
      'checked by median only (few samples)|1',
      'file entries not seen|3',
    ]);
    expect(rows(formatSummary(report('tool-error'), { width: 120, color: false }))).toEqual([
      'keys|1',
      'not evaluated|1',
    ]);
    const passed = formatSummary(report('passed'), { width: 120, color: false });
    expect(passed).toContain('│ Endpoints │');
    expect(passed).not.toContain('Steps');
    const off = report('passed');
    const time = off.config.checks?.time;
    if (time?.percentile !== undefined) time.percentile.enabled = false;
    expect(formatSummary(off, { width: 120, color: false })).toContain(
      '│ checked by median only (percentile rule off) │',
    );
  });

  test('09-AC-24 one Report line with the absolute path of report.html, else report.json', () => {
    const text = formatSummary(report('passed'), { width: 120, color: false });
    expect(text.endsWith('\nReport: /work/app/reports/pw-perf/report.html\n')).toBe(true);
    expect(text.split('\n').filter((l) => /report/iu.test(l))).toHaveLength(1);
    expect(formatSummary(report('passed'), { width: 120, color: false, html: false })).toContain(
      'Report: /work/app/reports/pw-perf/report.json\n',
    );
    const windows = report('passed');
    windows.configDir = 'C:\\work\\app';
    expect(formatSummary(windows, { width: 120, color: false })).toContain(
      'Report: C:/work/app/reports/pw-perf/report.html\n',
    );
  });

  test('a separator line over the terminal width comes first', () => {
    expect(formatSummary(report('passed'), { width: 60, color: false }).split('\n')[0]).toBe(
      '─'.repeat(60),
    );
  });

  test('truncateMiddle keeps the start and the end of a key', () => {
    expect(truncateMiddle('GET /api/abcdefghij', 10)).toBe('GET /…ghij');
    expect(truncateMiddle('short', 10)).toBe('short');
    expect(Array.from(truncateMiddle('x'.repeat(100), 30))).toHaveLength(30);
  });
});
