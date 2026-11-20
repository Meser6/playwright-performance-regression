import { describe, expect, test } from 'vitest';
import { formatThresholdsDiff } from '../../../src/console/thresholds-diff.ts';
import type { ResolvedConfig } from '../../../src/core/config/index.ts';
import type { LoadedThresholds } from '../../../src/core/evaluate/index.ts';
import {
  DIFF_CATEGORIES,
  deriveEntry,
  deriveThresholds,
  diffThresholds,
  formatThresholdsDiffMarkdown,
} from '../../../src/core/thresholds/index.ts';
import type { KeyDiff, ThresholdsDiff } from '../../../src/core/thresholds/index.ts';
import type { ThresholdsEntry } from '../../../src/core/types/index.ts';
import {
  absent,
  cfg,
  deriveOptions,
  existing,
  file,
  loadedFile,
  reportAggregate,
  runReport,
} from './thresholds-helpers.ts';
import type { ReportAggregateSpec, ReportSpec } from './thresholds-helpers.ts';

const FAST: ReportAggregateSpec = {
  durations: [
    [199, 120],
    [1, 600],
  ],
  percentiles: { p50: 120, p90: 210, p95: 260, p99: 410 },
};
const FRESH = deriveEntry(reportAggregate(FAST), 'api', cfg());

function diffs(
  spec: ReportSpec,
  files: LoadedThresholds = existing(),
  config: ResolvedConfig = cfg(),
  prune = false,
): ThresholdsDiff[] {
  const report = runReport(spec);
  const result = deriveThresholds(report, config, files, deriveOptions({ prune }));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value.files.map((f) => diffThresholds(files[f.kind], f, report, config));
}

function keyDiff(d: ThresholdsDiff | undefined, key: string): KeyDiff {
  const k = d?.keys.find((x) => x.key === key);
  if (k === undefined) throw new Error(`no diff for ${key}`);
  return k;
}

const CONSOLE = {
  width: 120,
  color: false,
  prune: false,
  diffPath: 'pw-perf-results/thresholds-diff.md',
};

describe('diffThresholds (10, chapter 9)', () => {
  test('10-AC-09 every key of both versions and every skipped key is in exactly one category', () => {
    const entries: Record<string, ThresholdsEntry> = {
      'k-loosened': { ...FRESH, median: FRESH.median - 50 },
      'k-tightened': { ...FRESH, percentile: FRESH.percentile + 200 },
      'k-mixed': { ...FRESH, median: FRESH.median - 50, maxErrorRate: 0.5 },
      'k-unchanged': { ...FRESH },
      'k-hysteresis': { ...FRESH, median: FRESH.median + 10 },
      'k-locked': { ...FRESH, locked: true, median: 1 },
      'k-incomplete': { median: 1 },
      'k-unseen': { ...FRESH },
      'k-unseen-locked': { ...FRESH, locked: true },
      'k-skipped': { ...FRESH },
    };
    const endpoints: Record<string, ReportAggregateSpec> = {
      'k-added': FAST,
      'k-loosened': FAST,
      'k-tightened': FAST,
      'k-mixed': FAST,
      'k-unchanged': FAST,
      'k-hysteresis': FAST,
      'k-locked': FAST,
      'k-incomplete': FAST,
      'k-skipped': { durations: [[3, 100]] },
      'k-skipped-new': { durations: [[3, 100]] },
      'k-zero': { errors: 10 },
    };
    const [api] = diffs({ endpoints }, existing(file('api', entries)));
    const category = (key: string): string => keyDiff(api, key).category;
    expect(Object.fromEntries(api?.keys.map((k) => [k.key, k.category]) ?? [])).toEqual({
      'k-added': 'added',
      'k-loosened': 'loosened',
      'k-tightened': 'tightened',
      'k-mixed': 'mixed',
      'k-unchanged': 'unchanged',
      'k-hysteresis': 'unchanged',
      'k-locked': 'locked',
      'k-incomplete': 'locked',
      'k-unseen': 'unseen',
      'k-unseen-locked': 'unseen',
      'k-skipped': 'skipped',
      'k-skipped-new': 'skipped',
      'k-zero': 'skipped',
    });
    expect(category('k-added')).toBe('added');
    expect(keyDiff(api, 'k-hysteresis').withinHysteresis).toBe(true);
    expect(keyDiff(api, 'k-unchanged').withinHysteresis).toBeUndefined();
    expect(keyDiff(api, 'k-incomplete').incomplete).toBe(true);
    expect(keyDiff(api, 'k-locked').incomplete).toBeUndefined();
    expect(keyDiff(api, 'k-added').limits).toEqual(FRESH);
    expect(Object.values(api?.counts ?? {}).reduce((a, b) => a + b, 0)).toBe(api?.keys.length);
    expect(api?.counts).toEqual({
      added: 1,
      removed: 0,
      loosened: 1,
      tightened: 1,
      mixed: 1,
      unchanged: 2,
      locked: 2,
      unseen: 2,
      skipped: 3,
    });
    expect(Object.keys(api?.counts ?? {})).toEqual([...DIFF_CATEGORIES]);

    const [pruned] = diffs({ endpoints }, existing(file('api', entries)), cfg(), true);
    expect(keyDiff(pruned, 'k-unseen').category).toBe('removed');
    expect(keyDiff(pruned, 'k-unseen').limits).toEqual(FRESH);
    expect(keyDiff(pruned, 'k-unseen-locked').category).toBe('unseen');
  });

  test('10-AC-09 directions: higher is looser except minApdex; to null is looser, from null stricter', () => {
    const slowFile = { ...FRESH, t: 500, minApdex: 0.9, maxWilson: 0.1 };
    const slow: ReportAggregateSpec = {
      durations: [[200, 2600]],
      percentiles: { p50: 2600, p90: 3000, p95: 3100, p99: 3200 },
    };
    const [toNull] = diffs({ endpoints: { k: slow } }, existing(file('api', { k: slowFile })));
    const changes = keyDiff(toNull, 'k').changes;
    expect(changes.filter((c) => c.after === null).map((c) => [c.limit, c.direction])).toEqual([
      ['t', 'looser'],
      ['minApdex', 'looser'],
      ['maxWilson', 'looser'],
    ]);
    const fromNull = { ...FRESH, t: null, minApdex: null, maxWilson: null };
    const [d] = diffs({ endpoints: { k: FAST } }, existing(file('api', { k: fromNull })));
    expect(keyDiff(d, 'k').changes.map((c) => [c.limit, c.direction])).toEqual([
      ['t', 'stricter'],
      ['minApdex', 'stricter'],
      ['maxWilson', 'stricter'],
    ]);
    expect(keyDiff(d, 'k').category).toBe('tightened');
    const apdexDown = { ...FRESH, minApdex: (FRESH.minApdex ?? 0) + 0.05 };
    const [a] = diffs({ endpoints: { k: FAST } }, existing(file('api', { k: apdexDown })));
    expect(keyDiff(a, 'k')).toMatchObject({
      category: 'loosened',
      changes: [{ limit: 'minApdex', direction: 'looser' }],
    });
  });

  test('fileStatus: created, updated and unchanged', () => {
    const first = diffs({ endpoints: { k: FAST } });
    expect(first.map((d) => d.fileStatus)).toEqual(['created']);
    expect(first[0]?.level).toBe('p95');
    const report = runReport({ endpoints: { k: FAST } });
    const derived = deriveThresholds(report, cfg(), existing(), deriveOptions());
    if (!derived.ok) throw new Error('refused');
    const content = derived.value.files[0]?.content;
    if (content === null || content === undefined) throw new Error('no content');
    const again = diffs({ endpoints: { k: FAST }, runId: 'run-2' }, existing(loadedFile(content)));
    expect(again.map((d) => d.fileStatus)).toEqual(['unchanged']);
    const updated = diffs({ endpoints: { k: FAST, k2: FAST } }, existing(loadedFile(content)));
    expect(updated[0]?.fileStatus).toBe('updated');
  });

  test('10-AC-13 the diff and thresholds-diff.md are produced also when no file changed', () => {
    const report = runReport({ endpoints: { k: FAST } });
    const first = deriveThresholds(report, cfg(), existing(), deriveOptions());
    if (!first.ok) throw new Error('refused');
    const content = first.value.files[0]?.content;
    if (content === null || content === undefined) throw new Error('no content');
    const d = diffs({ endpoints: { k: FAST }, runId: 'run-2' }, existing(loadedFile(content)));
    expect(d[0]?.counts.unchanged).toBe(1);
    const md = formatThresholdsDiffMarkdown(d, ['pw-perf-thresholds.api.json']);
    expect(md).toBe(
      [
        '# Thresholds diff',
        '',
        '## pw-perf-thresholds.api.json (unchanged)',
        '',
        '1 unchanged',
        '',
      ].join('\n'),
    );
    expect(formatThresholdsDiff(d, { ...CONSOLE, paths: ['a.json'] })).toBe(
      [
        'Thresholds: a.json (unchanged)',
        '',
        'The thresholds files are up to date.',
        'Diff: pw-perf-results/thresholds-diff.md',
        '',
      ].join('\n'),
    );
  });

  test('10-AC-17 a percentile limit 60% higher is marked large and with ! ; 40% is not', () => {
    const at = (factor: number): ThresholdsDiff[] =>
      diffs(
        { endpoints: { k: FAST } },
        existing(
          file('api', { k: { ...FRESH, percentile: Math.round(FRESH.percentile / factor) } }),
        ),
      );
    const much = at(1.6);
    expect(keyDiff(much[0], 'k').changes).toEqual([
      { limit: 'percentile', before: 228, after: 364, direction: 'looser', large: true },
    ]);
    expect(formatThresholdsDiff(much, { ...CONSOLE, paths: ['a'] })).toContain(
      '  ↑! k                               p95 228 → 364',
    );
    expect(formatThresholdsDiffMarkdown(much, ['a'])).toContain('| ↑! | `k` | p95 228 | p95 364 |');
    const little = at(1.4);
    expect(keyDiff(little[0], 'k').changes[0]?.large).toBeUndefined();
    expect(formatThresholdsDiff(little, { ...CONSOLE, paths: ['a'] })).not.toContain('!');
  });

  test('10-AC-18 KeyDiff.muted is relative to the source startedAt; an expired muting has its own line', () => {
    const muted = (until: string): ThresholdsEntry => ({
      ...FRESH,
      median: FRESH.median - 50,
      gate: 'warn',
      note: 'n',
      until,
    });
    const files = existing(
      file('api', {
        active: muted('2026-11-18'),
        expired: muted('2026-11-17'),
        plain: { ...FRESH },
      }),
    );
    const d = diffs(
      {
        endpoints: { active: FAST, expired: FAST, plain: FAST },
        startedAt: '2026-11-18T23:59:59.999Z',
      },
      files,
    );
    expect(keyDiff(d[0], 'active').muted).toEqual({ until: '2026-11-18', expired: false });
    expect(keyDiff(d[0], 'expired').muted).toEqual({ until: '2026-11-17', expired: true });
    expect(keyDiff(d[0], 'plain').muted).toBeUndefined();
    const text = formatThresholdsDiff(d, { ...CONSOLE, paths: ['a'] });
    expect(text).toContain('  ! expired muted (expired 2026-11-17)');
    expect(text).toContain('(muted until 2026-11-18)');
    expect(text).not.toContain('active muted (expired');
    const md = formatThresholdsDiffMarkdown(d, ['a']);
    expect(md).toContain('- `expired` muted (expired 2026-11-17)');
    expect(md).not.toContain('- `active` muted');
  });
});

describe('console and Markdown diff output (10, chapter 9.1, 10-REQ-19)', () => {
  const many = (n: number): Record<string, ReportAggregateSpec> =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`GET /api/k${String(i).padStart(2, '0')}`, FAST]),
    );

  test('at most 30 rows per file in the console; every row in thresholds-diff.md', () => {
    const d = diffs({ endpoints: many(35) });
    const text = formatThresholdsDiff(d, { ...CONSOLE, paths: ['api.json'] });
    expect(text.split('\n').filter((l) => l.startsWith('  + ')).length).toBe(30);
    expect(text).toContain('  … and 5 more\n');
    const md = formatThresholdsDiffMarkdown(d, ['api.json']);
    expect(md.split('\n').filter((l) => l.startsWith('| + |')).length).toBe(35);
  });

  test('long keys are shortened in the middle to the terminal width, at least 30 columns', () => {
    const key = `GET /api/${'x'.repeat(100)}/end`;
    const d = diffs({ endpoints: { [key]: FAST } });
    const text = formatThresholdsDiff(d, { ...CONSOLE, width: 80, paths: ['a'] });
    const row = text.split('\n').find((l) => l.startsWith('  + '));
    expect(row).toMatch(/^ {2}\+ GET \/api\/x+…x+\/end {2}t 500/u);
    expect(row?.indexOf('t 500')).toBe(2 + 1 + 1 + 30 + 2);
  });

  test('the unseen hint mentions --prune, or locked entries after --prune', () => {
    const files = existing(file('api', { gone: { ...FRESH }, kept: { ...FRESH, locked: true } }));
    const d = diffs({ endpoints: { k: FAST } }, files);
    expect(formatThresholdsDiff(d, { ...CONSOLE, paths: ['a'] })).toContain(
      '  2 entries were not seen in this run and were kept. Use --prune to remove them.',
    );
    const p = diffs({ endpoints: { k: FAST } }, files, cfg(), true);
    expect(formatThresholdsDiff(p, { ...CONSOLE, prune: true, paths: ['a'] })).toContain(
      '  1 entry not seen in this run was kept because it is locked.',
    );
  });

  test('colors only when requested', () => {
    const d = diffs({ endpoints: { k: FAST } });
    expect(formatThresholdsDiff(d, { ...CONSOLE, paths: ['a'] })).not.toContain('\u001b[');
    expect(formatThresholdsDiff(d, { ...CONSOLE, color: true, paths: ['a'] })).toContain(
      '\u001b[32m+\u001b[0m',
    );
  });

  test('Markdown escapes pipes and backticks of keys', () => {
    const d = diffs({ endpoints: { 'GET /a|b': FAST, 'GET /`x`': FAST } });
    const md = formatThresholdsDiffMarkdown(d, ['a']);
    expect(md).toContain('| + | `GET /a\\|b` |');
    expect(md).toContain('| + | GET /`x` |');
  });

  test('values: ms as integers, ratios with 3 places, null as null', () => {
    const slow: ReportAggregateSpec = { durations: [[200, 2600]] };
    const [api] = diffs({ endpoints: { k: slow } }, existing(absent('api')));
    const md = formatThresholdsDiffMarkdown(api === undefined ? [] : [api], ['a']);
    expect(md).toContain(
      't null · median 3640 · p95 3640 · p99 4004 · apdex null · wilson null · errors 0.050',
    );
  });
});
