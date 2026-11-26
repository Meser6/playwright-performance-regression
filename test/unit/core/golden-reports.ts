// Run reports of 1.1.0 built through the whole pipeline (aggregator → evaluate → buildRunReport):
// the golden reports `cold`, `fast-failure` and `workload-shift` of 02-REQ-43, stored in
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

export const GOLDEN_REPORT_NAMES = ['cold', 'fast-failure', 'workload-shift'] as const;
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
  return `${ORIGIN}${path.replace(':id', '7')}`;
}

/** Feeds the results to an aggregator in order, as the reporter does (08-REQ-41). */
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

const SCENARIOS: Record<GoldenReportName, Scenario> = {
  // 08-REQ-41…44: a slow first call excluded (10 samples), one kept for too few samples (5).
  cold: {
    name: 'cold samples: a slow first call left out of the statistics, one kept with too few samples (08-REQ-41…44)',
    config: {},
    passes: 5,
    results: passesOf(5, 'tickets › opens the list', (pass) => [
      ['GET /api/tickets', 200, pass === 0 ? 1840 : around(120, pass)],
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
};

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
  feed(agg, s.results);
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
