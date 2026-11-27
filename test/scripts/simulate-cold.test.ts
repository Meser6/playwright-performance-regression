// scripts/simulate-cold.mjs (08-REQ-45): replays pass files with coldSamples 0, 1 and 2.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { stringifyStable } from '../../src/core/format/index.ts';
import { JournalAggregator } from '../../src/reporter/pass-file.ts';
import type { PassEntry } from '../../src/reporter/pass-file.ts';
import { feed, goldenReportCase, scenarioResults } from '../unit/core/golden-reports.ts';

const SCRIPT = join(import.meta.dirname, '../../scripts/simulate-cold.mjs');
const dir = mkdtempSync(join(tmpdir(), 'pw-perf-simulate-'));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A report dir of the cold scenario: report.json and one pass file per pass. */
function runDir(name: string): string {
  const out = join(dir, name);
  const report = goldenReportCase('cold').input;
  const results = scenarioResults('cold');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'report.json'), stringifyStable(report));
  results.forEach((result, i) => {
    const agg = new JournalAggregator({
      advanced: { maxSamplesPerKey: 5000, seed: 1 },
      successStatuses: ['2xx', '3xx'],
      errors: { statuses: ['5xx'] },
      measuredProjects: new Set(['chromium']),
      evaluatedPercentile: 'p95',
      rawUrls: false,
    });
    const journal: PassEntry[] = [];
    agg.journal = journal;
    feed(agg, [result]);
    writeFileSync(join(out, `pass-${String(i + 1)}.json`), JSON.stringify({ entries: journal }));
  });
  return out;
}

describe('simulate-cold.mjs (08-REQ-45)', () => {
  test('reports evaluated keys, false alarms and the slowdown for coldSamples 0, 1 and 2', () => {
    const thresholds = runDir('thresholds');
    const run = runDir('test');
    const out = execFileSync(
      process.execPath,
      [SCRIPT, '--thresholds', thresholds, '--test', run, '--slow', 'GET /api/tickets', '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const result = JSON.parse(out) as {
      slowKey: string;
      results: { coldSamples: number; evaluatedKeys: number[]; falseAlarms: number[] }[];
    };
    expect(result.slowKey).toBe('GET /api/tickets');
    expect(result.results.map((r) => r.coldSamples)).toEqual([0, 1, 2]);
    // The same data in both runs: no false alarm with any value.
    for (const r of result.results) {
      expect(r.evaluatedKeys).toEqual([3]);
      expect(r.falseAlarms).toEqual([0]);
    }
  });
});
