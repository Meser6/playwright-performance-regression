// The golden run reports of 1.1.0 (02-REQ-43): built through the pipeline and compared with
// test/golden/run-report/valid/<name>.json; GOLDEN_UPDATE=1 rewrites them (12-REQ-16) together with
// the console case test/golden/console/workload-shift.json. The diff must be reviewed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../../../src/core/config/index.ts';
import { parseRunReport } from '../../../src/core/schema/index.ts';
import { stringifyStable } from '../../../src/core/format/index.ts';
import { Aggregator } from '../../../src/core/stats/index.ts';
import { JournalAggregator, replayEntries } from '../../../src/reporter/pass-file.ts';
import type { PassEntry } from '../../../src/reporter/pass-file.ts';
import { GOLDEN_DIR } from '../../contract/golden.ts';
import {
  GOLDEN_REPORT_NAMES,
  feedPasses,
  goldenReportCase,
  scenarioResults,
} from './golden-reports.ts';

const update = process.env['GOLDEN_UPDATE'] === '1';

function text(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

describe('golden run reports of 1.1.0 (02-REQ-43)', () => {
  for (const name of GOLDEN_REPORT_NAMES) {
    test(`${name}.json equals the report built by the pipeline and is valid`, () => {
      const c = goldenReportCase(name);
      const file = join(GOLDEN_DIR, 'run-report', 'valid', `${name}.json`);
      if (update) {
        writeFileSync(file, text(c));
        if (name === 'workload-shift') {
          writeFileSync(join(GOLDEN_DIR, 'console', `${name}.json`), text(c));
        }
      }
      expect(existsSync(file), file).toBe(true);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(JSON.parse(text(c)));
      const parsed = parseRunReport(text(c.input), file);
      expect(parsed.ok, JSON.stringify(parsed.ok ? null : parsed.issues)).toBe(true);
    });
  }

  test('the cold report has an excluded and a kept cold block and STATS_COLD_SLOW', () => {
    const report = goldenReportCase('cold').input;
    // One cold sample in each of the 5 passes (08-REQ-41).
    expect(report.endpoints['GET /api/tickets']?.cold).toMatchObject({
      count: 5,
      excluded: true,
      reason: null,
      max: 1840,
    });
    // Called once per pass: every sample is cold, all stay in the statistics.
    expect(report.endpoints['GET /api/users']?.cold).toMatchObject({
      count: 5,
      excluded: false,
      reason: 'too-few-samples',
    });
    // Its warmP50 is the p50 of all its samples, so its slow start still gives a ratio.
    const users = report.endpoints['GET /api/users'];
    expect(users?.cold?.warmP50).toBe(users?.stats?.percentiles['p50']);
    expect(report.warnings.map((w) => w.code)).toContain('STATS_COLD_SLOW');
  });

  test('17-AC-09 the merged golden report has two shards, a cold sample per shard and is valid', () => {
    const report = goldenReportCase('merged').input;
    expect(report.shards?.total).toBe(2);
    expect(report.shards?.list.map((s) => s.index)).toEqual([1, 2]);
    // One cold sample per shard and pass: 2 shards × 3 passes (17-REQ-15, 17-AC-11).
    expect(report.endpoints['GET /api/tickets']?.cold).toMatchObject({
      count: 6,
      excluded: true,
      max: 1400,
    });
    expect(report.endpoints['GET /api/tickets']?.cold?.durations[0]).toBe(1300);
    expect(report.endpoints['GET /api/tickets']?.cold?.durations[3]).toBe(1400);
    const parsed = parseRunReport(text(report), 'merged.json');
    expect(parsed.ok).toBe(true);
  });

  test('08-AC-26 replaying the pass journal picks the same cold samples (golden report cold)', () => {
    const resolved = resolveConfig({}, {});
    if (!resolved.ok) throw new Error('config');
    const cfg = resolved.value.config;
    const options = {
      advanced: cfg.advanced,
      successStatuses: cfg.measure.successStatuses,
      errors: { statuses: cfg.checks.errors.statuses },
      measuredProjects: new Set(['chromium']),
      evaluatedPercentile: cfg.checks.time.percentile.level,
      rawUrls: false,
      coldSamples: cfg.measure.coldSamples,
      minSamples: cfg.checks.time.median.minSamples,
    };
    // The results of the cold report, recorded as passes 1…5 of a run (02-REQ-36).
    const live = new JournalAggregator(options);
    const journal: PassEntry[] = [];
    live.journal = journal;
    const report = goldenReportCase('cold').input;
    // Pass boundaries go to the journal too (08-REQ-41, 17-REQ-10).
    feedPasses(live, scenarioResults('cold'));
    expect(journal.filter((e) => e[0] === 'p')).toHaveLength(4);
    const replayed = new Aggregator(options);
    // The pass file is JSON: the replay reads what was written.
    replayEntries(replayed, JSON.parse(JSON.stringify(journal)) as PassEntry[]);
    const a = live.finalize();
    const b = replayed.finalize();
    expect(stringifyStable(b.endpoints)).toBe(stringifyStable(a.endpoints));
    for (const [key, agg] of Object.entries(report.endpoints)) {
      expect(a.endpoints[key]?.cold, key).toEqual(agg.cold);
    }
  });
});
