import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  exceedance,
  formatSummary,
  overText,
  relativePath,
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
const CWD = '/work/app';
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
  const text = formatSummary(report(name), { width, color: false, cwd: CWD });
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
    const text = formatSummary(report('failed-run'), { width: 60, color: false, cwd: CWD });
    const row = text.split('\n').find((l) => l.includes('lude&page&sort'));
    expect(row).toContain('  GET /api/organi…lude&page&sort  ');
  });

  test('09-AC-20 the over column follows Math.round((r - 1) * 100), also for apdex and >999%', () => {
    const text = formatSummary(report('failed-run'), { width: 120, color: false, cwd: CWD });
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
    const text = formatSummary(report('failed-run'), { width: 120, color: false, cwd: CWD });
    const markers = text
      .split('\n')
      .filter((l) => /^ {2}[✖!] (?:api|custom) /u.test(l))
      .map((l) => l.slice(2, 3));
    expect(markers.indexOf('!')).toBeGreaterThan(markers.lastIndexOf('✖'));
    const many = formatSummary(report('thresholds-mode-warn-only'), {
      width: 120,
      color: false,
      cwd: CWD,
    });
    expect(many.split('\n').filter((l) => l.startsWith('  ! api'))).toHaveLength(20);
    expect(many).toContain('  … and 2 more violations (see report)');
    expect(many).toContain('  … and 2 more warnings (see report)');
    expect(many).toContain('(informational, gate disabled)');
  });

  test('muted keys are listed and flagged MUTED', () => {
    const text = formatSummary(report('failed-run'), { width: 120, color: false, cwd: CWD });
    expect(text).toContain(
      'Muted:     POST /api/reports/export until 2026-12-31 — "Depends on report service, tracked in backlog"',
    );
    const row = text
      .split('\n')
      .find((l) => l.includes('POST /api/reports/export') && l.startsWith('  !'));
    expect(row?.endsWith('MUTED')).toBe(true);
  });

  test('colors only when asked; the text without them is the same', () => {
    const plain = formatSummary(report('failed-run'), { width: 120, color: false, cwd: CWD });
    const colored = formatSummary(report('failed-run'), { width: 120, color: true, cwd: CWD });
    expect(plain).not.toContain('\u001b[');
    expect(colored).toContain('\u001b[31m✖\u001b[0m');
    expect(colored.replace(new RegExp(`${String.fromCharCode(27)}\\[\\d+m`, 'gu'), '')).toBe(plain);
  });

  test('report paths are relative to the current directory', () => {
    expect(formatSummary(report('passed'), { width: 120, color: false, cwd: '/work' })).toContain(
      'Report: app/perf-results/report.html · app/perf-results/report.json',
    );
    expect(relativePath('/work/app/sub', '/work/app/perf-results/report.json')).toBe(
      '../perf-results/report.json',
    );
    expect(relativePath('C:\\work', 'C:\\work\\out\\r.json')).toBe('out/r.json');
    expect(relativePath('/a', '/a')).toBe('.');
  });

  test('truncateMiddle keeps the start and the end of a key', () => {
    expect(truncateMiddle('GET /api/abcdefghij', 10)).toBe('GET /…ghij');
    expect(truncateMiddle('short', 10)).toBe('short');
    expect(Array.from(truncateMiddle('x'.repeat(100), 30))).toHaveLength(30);
  });
});
