// Run reports of 1.1.0 built through the whole pipeline (aggregator → evaluate → buildRunReport):
// the golden reports `cold`, `fast-failure`, `workload-shift`, `operations` and `merged` of
// 02-REQ-43 (`merged`: two shards replayed as segments, 17-REQ-15, 17-REQ-26), stored in
// test/golden/run-report/valid/ and rendered by the HTML, console and junit golden tests.
import { resolveConfig } from '../../../src/core/config/index.ts';
import type { PerfConfigInput } from '../../../src/core/config/index.ts';
import { evaluate } from '../../../src/core/evaluate/index.ts';
import type { LoadedThresholds, RunSource } from '../../../src/core/evaluate/index.ts';
import { buildRunReport } from '../../../src/core/report/index.ts';
import { Aggregator, resultId, testIdentity } from '../../../src/core/stats/index.ts';
import type { EnrichedRequestSample, TestMeta } from '../../../src/core/stats/index.ts';
import type { RunReport, ThresholdsEntry } from '../../../src/core/types/index.ts';
import { loadCases } from '../../contract/golden.ts';
import { files, loaded, missing } from './evaluate-helpers.ts';
import { generated } from './thresholds-helpers.ts';

export const GOLDEN_REPORT_NAMES = [
  'cold',
  'fast-failure',
  'workload-shift',
  'operations',
  'merged',
] as const;
export type GoldenReportName = (typeof GOLDEN_REPORT_NAMES)[number];

const ORIGIN = 'https://app.example';
const START = Date.UTC(2026, 10, 26, 10, 0, 0, 0);

/** One call of a key in a test result: key, status and duration in ms. */
type Call = [key: string, status: number, duration: number];

/** One test result: its test and its calls in order (ordinal = index). */
interface Result {
  title: string;
  file: string;
  line: number;
  pass: number;
  calls: Call[];
}

function base(): RunReport {
  const found = loadCases('run-report').find(
    (c) => c.dir === 'valid' && c.file === 'full-run.json',
  );
  return structuredClone(found?.input) as RunReport;
}

function metaOf(r: Result): TestMeta {
  const project = 'chromium';
  return {
    identity: testIdentity(project, r.file, r.title),
    resultId: resultId(`${r.file}:${r.title}`, r.pass, 0),
    title: r.title,
    project,
    file: r.file,
    line: r.line,
    repeatEachIndex: r.pass,
    retry: 0,
    failed: false,
    startTime: START + r.pass * 60_000,
  };
}

function urlOf(key: string): string {
  const [, path = '/'] = key.split(' ');
  // The operation part (18-REQ-06) is not in the URL.
  return `${ORIGIN}${path.replace(':id', '7').split('#', 1)[0] ?? ''}`;
}

/**
 * Feeds the results pass by pass, as the reporter does: the results of pass 1, then a new segment
 * and the results of pass 2, … (08-REQ-41); the order within a pass is kept.
 */
export function feedPasses(agg: Aggregator, results: readonly Result[]): void {
  const passes = [...new Set(results.map((r) => r.pass))].sort((a, b) => a - b);
  passes.forEach((pass, i) => {
    if (i > 0) agg.startSegment();
    feed(
      agg,
      results.filter((r) => r.pass === pass),
    );
  });
}

/** Feeds the results to an aggregator in order, within one pass (08-REQ-41). */
export function feed(agg: Aggregator, results: readonly Result[]): void {
  for (const r of results) {
    const test = metaOf(r);
    r.calls.forEach(([key, status, duration], ordinal) => {
      const sample: EnrichedRequestSample = {
        method: key.split(' ')[0] ?? 'GET',
        url: urlOf(key),
        resourceType: 'fetch',
        status,
        startTime: test.startTime + ordinal * 1000,
        duration,
        requestStart: 1,
        ttfb: Math.round(duration * 6) / 10,
        timeSource: 'browser',
        fromServiceWorker: false,
        ordinal,
        test,
      };
      agg.addRequest(key, sample, ORIGIN, '', 'chromium');
    });
    agg.endResult(test);
  }
}

/** Durations around `ms` that differ by a few ms, deterministic. */
function around(ms: number, i: number): number {
  return ms + ((i * 7) % 11) - 5;
}

interface Scenario {
  name: string;
  config: PerfConfigInput;
  passes: number;
  results: Result[];
  thresholds: (source: RunSource) => LoadedThresholds;
  /** A merge (17-REQ-15): the number of results of each shard, in shard order. */
  shards?: number[];
}

/** Results of `passes` passes of one test calling the keys of `perPass(pass)`. */
function passesOf(
  passes: number,
  title: string,
  perPass: (pass: number) => Call[],
  file = 'tests/app.spec.ts',
  line = 12,
): Result[] {
  return Array.from({ length: passes }, (_, pass) => ({
    title,
    file,
    line,
    pass,
    calls: perPass(pass),
  }));
}

function generatedFor(source: RunSource): ReturnType<typeof generated> {
  return generated({
    browsers: source.browsers,
    playwrightVersion: source.playwrightVersion,
    host: source.host,
    normalization: source.normalization,
  });
}

/** Results of `passes` passes of one test in shard `shard` (one cold first call per shard). */
function shardResults(shard: number, title: string, file: string, line: number): Result[] {
  return passesOf(
    3,
    title,
    (pass) => [
      ['GET /api/tickets', 200, pass === 0 ? 1200 + shard * 100 : around(120, pass + shard)],
      [`GET /api/shard${String(shard)}`, 200, around(90 + shard * 20, pass)],
    ],
    file,
    line,
  );
}

const MERGED: Scenario = {
  name: 'merged: two shards of 3 passes, a key called in both with one cold sample per shard (17-REQ-15…17)',
  config: { run: { passes: { test: 3 } } },
  passes: 3,
  results: [
    ...shardResults(1, 'tickets › opens the list', 'tests/tickets.spec.ts', 5),
    ...shardResults(1, 'tickets › filters the list', 'tests/tickets.spec.ts', 18),
    ...shardResults(2, 'admin › opens the tickets', 'tests/admin.spec.ts', 7),
    ...shardResults(2, 'admin › exports the tickets', 'tests/admin.spec.ts', 21),
  ],
  shards: [6, 6],
  thresholds: () => files(missing('api')),
};

const SCENARIOS: Record<GoldenReportName, Scenario> = {
  merged: MERGED,
  // 08-REQ-41…44: a slow first call in every pass excluded (2 calls per pass), the cold samples of a
  // key called once per pass kept for too few warm samples.
  cold: {
    name: 'cold samples: a slow first call in each pass left out of the statistics, one kept with too few warm samples (08-REQ-41…44)',
    config: {},
    passes: 5,
    results: passesOf(5, 'tickets › opens the list', (pass) => [
      ['GET /api/tickets', 200, 1840 - pass * 60],
      ['GET /api/tickets', 200, around(120, pass + 5)],
      ['GET /api/users', 200, pass === 0 ? 900 : around(100, pass)],
      ['POST /api/orders', 200, around(130, pass)],
      ['POST /api/orders', 200, around(125, pass + 3)],
    ]),
    thresholds: () => files(missing('api')),
  },
  // 09-REQ-38, 09-REQ-39, 08-REQ-46/47: an endpoint that answered 200 now answers fast 401s.
  'fast-failure': {
    name: 'fast failures: 20 × 401 in 8 ms on a key whose thresholds run had 20 × 200 (09-REQ-38, G11)',
    config: {},
    passes: 10,
    results: passesOf(10, 'account › shows the profile', (pass) => [
      ['GET /api/me', 401, around(8, pass)],
      ['GET /api/me', 401, around(8, pass + 4)],
      ['GET /api/cart', pass % 4 === 0 ? 403 : 200, pass % 4 === 0 ? 6 : around(120, pass)],
      ['GET /api/cart', 200, around(118, pass + 2)],
      ['POST /api/orders', pass === 3 ? 500 : 200, around(240, pass)],
      ['POST /api/orders', 200, around(235, pass + 1)],
    ]),
    thresholds: (source) => {
      const entry = (limits: ThresholdsEntry, count: number, success: number): ThresholdsEntry => ({
        t: 500,
        median: 220,
        percentile: 364,
        p99: 492,
        minApdex: 0.9,
        maxWilson: 0.1,
        maxErrorRate: 0.05,
        ...limits,
        source: { count, successCount: success, passes: 10, share: 0.3333 },
      });
      return files(
        loaded(
          'api',
          {
            'GET /api/me': entry(
              { median: 160, percentile: 240, p99: 300, maxNonSuccessRate: 0.05 },
              20,
              20,
            ),
            'GET /api/cart': entry({ maxNonSuccessRate: 0.395 }, 20, 15),
            'POST /api/orders': entry(
              { median: 340, percentile: 476, p99: 600, maxNonSuccessRate: 0.05 },
              20,
              20,
            ),
          },
          generatedFor(source),
        ),
      );
    },
  },
  // 09-REQ-40…42: fewer samples per pass than in the thresholds run.
  'workload-shift': {
    name: 'workload shift: samples per pass differ from the thresholds run (09-REQ-40…42)',
    config: {},
    passes: 5,
    results: [
      // GET /api/tickets: 13 calls in 5 passes (2.6 per pass) vs 40 in 10 (4.0): ×0.65.
      ...passesOf(5, 'tickets › opens the list', (pass) =>
        Array.from({ length: pass < 3 ? 3 : 2 }, (_, i): Call => [
          'GET /api/tickets',
          200,
          around(310, pass * 3 + i),
        ]),
      ),
      // GET /api/search: 6 calls in 5 passes (1.2 per pass) vs 40 in 10 (4.0): ×0.30, shifted.
      ...passesOf(
        5,
        'search › finds a ticket',
        (pass): Call[] =>
          Array.from({ length: pass === 0 ? 2 : 1 }, (_, i): Call => [
            'GET /api/search',
            200,
            around(420, pass + i),
          ]),
        'tests/search.spec.ts',
        20,
      ),
    ],
    thresholds: (source) =>
      files(
        loaded(
          'api',
          {
            'GET /api/tickets': {
              t: 500,
              median: 220,
              percentile: 364,
              p99: 492,
              minApdex: 0.9,
              maxWilson: 0.1,
              maxErrorRate: 0.05,
              maxNonSuccessRate: 0.05,
              source: { count: 40, successCount: 40, passes: 10, share: 0.5 },
            },
            'GET /api/search': {
              t: 500,
              median: 300,
              percentile: 420,
              p99: 520,
              minApdex: 0.9,
              maxWilson: 0.1,
              maxErrorRate: 0.05,
              maxNonSuccessRate: 0.05,
              source: { count: 40, successCount: 40, passes: 10, share: 0.5 },
            },
          },
          { ...generatedFor(source), sourcePasses: 10, sourceSampleCount: 80 },
        ),
      ),
  },
  // 18-REQ-06, 18-REQ-12: the first run after enabling keys.operations.
  operations: {
    name: 'operation keys: the first run after enabling keys.operations, with one slow operation (18-REQ-06, 18-REQ-12)',
    config: {
      keys: {
        operations: [
          { type: 'graphql', match: '/graphql' },
          { type: 'trpc', match: '/api/trpc/' },
        ],
      },
    },
    passes: 5,
    results: [
      ...passesOf(5, 'tickets › opens the list', (pass) => [
        ['POST /graphql#GetTickets', 200, around(90, pass)],
        ['POST /graphql#GetTickets+GetUser', 200, around(140, pass)],
        ['GET /api/trpc#a.get+b.list', 200, around(60, pass)],
      ]),
      ...passesOf(
        5,
        'orders › creates an order',
        (pass) => [
          ['POST /graphql#GetTickets', 200, around(95, pass + 2)],
          ['POST /graphql#CreateOrder', 200, around(2600, pass)],
        ],
        'tests/orders.spec.ts',
        8,
      ),
    ],
    // The file of 1.0.x: one key for every GraphQL call, derived with another fingerprint.
    thresholds: (source) =>
      files(
        loaded(
          'api',
          {
            'POST /graphql': {
              t: 500,
              median: 240,
              percentile: 1400,
              p99: 2800,
              minApdex: 0.7,
              maxWilson: 0.3,
              maxErrorRate: 0.05,
            },
          },
          { ...generatedFor(source), normalization: '1be5f2f3d77e9e' },
        ),
      ),
  },
};

/** The shards field of a merged golden report (17-REQ-17). */
function shardsOf(s: Scenario, meta: RunReport): RunReport['shards'] {
  if (s.shards === undefined) return null;
  const start = Date.parse(meta.startedAt);
  return {
    total: s.shards.length,
    missing: [],
    list: s.shards.map((count, i) => ({
      index: i + 1,
      runId: `2026-11-27T10-00-0${String(i)}-00a${String(i + 1)}`,
      startedAt: new Date(start + i * 1000).toISOString(),
      finishedAt: new Date(start + 600_000 + i * 45_000).toISOString(),
      status: 'passed' as const,
      passes: { planned: s.passes, completed: s.passes, failed: [] },
      tests: { status: 'passed' as const, expected: count, unexpected: 0, flaky: 0, skipped: 0 },
      samples: count * 2,
      host: { ...meta.host },
      buildUrl: `https://github.com/acme/shop/actions/runs/42/job/${String(i + 1)}`,
    })),
  };
}

/** The test results of a scenario in input order (08-REQ-41). */
export function scenarioResults(name: GoldenReportName): readonly Result[] {
  return SCENARIOS[name].results;
}

/** The golden case of `name`: { name, input: run report, expected: { ok: true } }. */
export function goldenReportCase(name: GoldenReportName): {
  name: string;
  input: RunReport;
  expected: { ok: true };
} {
  const s = SCENARIOS[name];
  const resolved = resolveConfig(s.config, {});
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.issues));
  const cfg = resolved.value.config;
  const meta = base();
  const agg = new Aggregator({
    advanced: cfg.advanced,
    successStatuses: cfg.measure.successStatuses,
    errors: { statuses: cfg.checks.errors.statuses },
    measuredProjects: new Set(['chromium']),
    evaluatedPercentile: cfg.checks.time.percentile.level,
    rawUrls: false,
    coldSamples: cfg.measure.coldSamples,
    minSamples: cfg.checks.time.median.minSamples,
  });
  if (s.shards === undefined) feedPasses(agg, s.results);
  else {
    // Each shard and each of its passes is a segment: its first calls are cold again (17-REQ-15).
    let offset = 0;
    for (const count of s.shards) {
      agg.startSegment();
      feedPasses(agg, s.results.slice(offset, offset + count));
      offset += count;
    }
  }
  const aggregates = agg.finalize();
  const { nodeVersion: _, ...host } = meta.host;
  const source: RunSource = {
    browsers: ['chromium'],
    playwrightVersion: meta.playwright.version,
    host,
    normalization: meta.normalization,
    stepNormalization: null,
    coldSamples: cfg.measure.coldSamples,
  };
  const evaluation = evaluate(aggregates, s.thresholds(source), cfg, {
    mode: 'test',
    env: null,
    fatalToolError: false,
    source,
    startedAt: meta.startedAt,
    passes: s.passes,
    workers: 1,
  });
  const input = buildRunReport({
    meta: { ...meta, mode: 'test', env: null },
    config: resolved.value.snapshot,
    normalization: meta.normalization,
    stepNormalization: null,
    passes: { planned: s.passes, completed: s.passes, failed: [] },
    shards: shardsOf(s, meta),
    runConditions: {
      workers: 1,
      projects: [
        { name: 'chromium', role: 'measured', browserName: 'chromium', repeatEach: 1, retries: 0 },
      ],
      overriddenSettings: [],
    },
    tests: { status: 'passed', expected: s.results.length, unexpected: 0, flaky: 0, skipped: 0 },
    aggregates,
    evaluation,
    warnings: [...aggregates.issues, ...evaluation.warnings],
    toolErrors: evaluation.toolErrors,
  });
  return { name: s.name, input, expected: { ok: true } };
}
