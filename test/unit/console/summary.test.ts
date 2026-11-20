import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  exceedance,
  formatSummary,
  overText,
  truncateMiddle,
} from '../../../src/console/summary.ts';
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
    expect(row).toContain('  GET /api/organi…lude&page&sort  ');
  });

  test('09-AC-20 the over column follows Math.round((r - 1) * 100), also for apdex and >999%', () => {
    const text = formatSummary(report('failed-run'), { width: 120, color: false });
    const rows = text.split('\n');
    const row = (key: string, rule: string) =>
      rows.find((l) => l.includes(` ${key} `) && l.includes(` ${rule} `)) ?? '';
    // errors: actual 0.1176 / limit 0.05 = 2.352 → +135%.
    expect(row('POST /api/orders', 'errors')).toMatch(/0\.118 \(0\.400\)\s+0\.050\s+\+135%/u);
    // apdex: limit / actual.
    const search = report('failed-run').endpoints['GET /api/search']?.evaluation.checks;
    const apdex = search?.find((c) => c.rule === 'apdex');
    expect(apdex).toBeDefined();
    if (apdex !== undefined) {
      const over = Math.round((apdex.limit / apdex.actual - 1) * 100);
      expect(row('GET /api/search', 'apdex')).toContain(`+${over}%`);
    }
    // median 50 ms at limit 1 ms: +4900% is shown as >999%.
    expect(row('GET /api/health', 'median')).toContain('>999%');
    expect(row('GET /api/tickets/:id?search', 'p95')).toMatch(/1712 ms\s+1400 ms\s+\+22%/u);
  });

  test('09-AC-20 over and exceedance edge cases', () => {
    expect(overText({ rule: 'errors', actual: 0.1176, limit: 0.05 })).toBe('+135%');
    expect(overText({ rule: 'apdex', actual: 0.7811, limit: 0.85 })).toBe('+9%');
    expect(overText({ rule: 'apdex', actual: 0, limit: 0.85 })).toBe('>999%');
    expect(overText({ rule: 'errors', actual: 0.01, limit: 0 })).toBe('>999%');
    expect(overText({ rule: 'median', actual: 1100, limit: 100 })).toBe('>999%');
    expect(overText({ rule: 'median', actual: 1099.4, limit: 100 })).toBe('+999%');
    expect(overText({ rule: 'median', actual: 1400.1, limit: 1400 })).toBe('+0%');
    expect(exceedance({ rule: 'apdex', actual: 0, limit: 0.9 })).toBe(Infinity);
  });

  test('violations: blocking first, then by exceedance; at most 20 rows', () => {
    const text = formatSummary(report('failed-run'), { width: 120, color: false });
    const markers = text
      .split('\n')
      .filter((l) => /^ {2}[✖!] (?:api|custom) /u.test(l))
      .map((l) => l.slice(2, 3));
    expect(markers.indexOf('!')).toBeGreaterThan(markers.lastIndexOf('✖'));
    const many = formatSummary(report('thresholds-mode-warn-only'), {
      width: 120,
      color: false,
    });
    expect(many.split('\n').filter((l) => l.startsWith('  ! api'))).toHaveLength(20);
    expect(many).toContain('  … and 2 more violations (see report)');
    expect(many).toContain('  … and 1 more warning (see report)');
    expect(many).toContain('(informational, gate disabled)');
  });

  test('muted keys are listed and flagged MUTED', () => {
    const text = formatSummary(report('failed-run'), { width: 120, color: false });
    expect(text).toContain(
      'Muted:     POST /api/reports/export until 2026-12-31 — "Depends on report service, tracked in backlog"',
    );
    const row = text
      .split('\n')
      .find((l) => l.includes('POST /api/reports/export') && l.startsWith('  !'));
    expect(row?.endsWith('MUTED')).toBe(true);
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
    expect(colored).toContain(`${ESC}[1mWarnings:${ESC}[0m`);
    expect(colored).toContain(`${ESC}[1mEndpoints:${ESC}[0m`);
    expect(colored).toContain(`${ESC}[1mMuted:${ESC}[0m`);
    expect(colored).toContain(`${ESC}[1mReport:${ESC}[0m`);
    expect(colored).toContain(`${ESC}[33m! TESTS_FAILED${ESC}[0m: `);
    expect(colored).toContain(
      `${ESC}[2m    Hint: Functional failures are reported by your regular test run.${ESC}[0m`,
    );
    // Table: bold head, blocking rows red, non-blocking rows yellow.
    expect(lines.find((l) => l.includes('kind') && l.includes('flag'))).toMatch(
      new RegExp(`^${ESC}\\[1m`, 'u'),
    );
    const row = (text: string) => lines.find((l) => l.includes(text)) ?? '';
    expect(row('GET /api/health')).toMatch(new RegExp(`^${ESC}\\[31m  ✖ api `, 'u'));
    expect(row('file  MUTED')).toMatch(new RegExp(`^${ESC}\\[33m  ! api `, 'u'));
    // Verdict badge: bold on a colored background.
    expect(colored).toContain(`${ESC}[1;97;41m ✖ FAILED ${ESC}[0m 6 blocking violations`);
    const errors = formatSummary(report('tool-error'), { width: 120, color: true });
    expect(errors).toContain(`${ESC}[1mErrors:${ESC}[0m`);
    expect(errors).toContain(`${ESC}[31m✖ SCHEMA_INVALID_JSON${ESC}[0m: `);
    expect(errors).toContain(`${ESC}[1;97;45m ✖ ERROR ${ESC}[0m `);
    expect(formatSummary(report('passed'), { width: 120, color: true })).toContain(
      `${ESC}[1;30;42m ✔ PASSED ${ESC}[0m `,
    );
    expect(
      formatSummary(report('thresholds-mode-warn-only'), { width: 120, color: true }),
    ).toContain(`${ESC}[1;30;43m ! PASSED WITH WARNINGS ${ESC}[0m `);
  });

  test('09-AC-22 ERROR names the cause: too many failed tests is not a tool error', () => {
    const text = formatSummary(report('tests-failed-too-many'), { width: 120, color: false });
    expect(text).toContain(
      ' ✖ ERROR  too many failed tests (30 of 101 executions); the performance result is not trustworthy\n',
    );
    expect(text).not.toContain('tool error');
    expect(formatSummary(report('tool-error'), { width: 120, color: false })).toContain(
      ' ✖ ERROR  1 tool error; the performance result is not trustworthy\n',
    );
    const both = report('tests-failed-too-many');
    both.toolErrors.push(
      { code: 'RUN_INCOMPLETE', message: 'The run timed out.' },
      { code: 'REPORT_WRITE_FAILED', message: 'x' },
    );
    expect(formatSummary(both, { width: 120, color: false })).toContain(
      ' ✖ ERROR  too many failed tests (30 of 101 executions), the run did not complete, 1 tool error; the performance result is not trustworthy\n',
    );
  });

  test('09-AC-24 counters omit zeros and say what they count', () => {
    const passed = formatSummary(report('passed'), { width: 120, color: false });
    expect(passed).toContain(
      'Endpoints: 2 keys · 1 from file · 1 on default thresholds · 1 checked by median only (few samples)\n',
    );
    expect(passed).not.toContain('Custom:');
    const failed = formatSummary(report('failed-run'), { width: 120, color: false });
    expect(failed).toContain(
      'Endpoints: 9 keys · 7 from file · 1 on default thresholds · 1 skipped (too few samples) · 1 checked by median only (few samples) · 3 file entries not seen\n',
    );
    expect(failed).toContain('Custom:    2 keys · 1 from file · 1 on default thresholds\n');
    expect(formatSummary(report('tool-error'), { width: 120, color: false })).toContain(
      'Endpoints: 1 key · 1 not evaluated\n',
    );
    const off = report('passed');
    const time = off.config.checks?.time;
    if (time?.percentile !== undefined) time.percentile.enabled = false;
    expect(formatSummary(off, { width: 120, color: false })).toContain(
      '1 checked by median only (percentile rule off)',
    );
  });

  test('09-AC-24 one Report line with the absolute path of report.html, else report.json', () => {
    const text = formatSummary(report('passed'), { width: 120, color: false });
    expect(text.endsWith('\nReport: /work/app/pw-perf-results/report.html\n')).toBe(true);
    expect(text.split('\n').filter((l) => /report/iu.test(l))).toHaveLength(1);
    expect(formatSummary(report('passed'), { width: 120, color: false, html: false })).toContain(
      'Report: /work/app/pw-perf-results/report.json\n',
    );
    const windows = report('passed');
    windows.configDir = 'C:\\work\\app';
    expect(formatSummary(windows, { width: 120, color: false })).toContain(
      'Report: C:/work/app/pw-perf-results/report.html\n',
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
