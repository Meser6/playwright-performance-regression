// Aggregator: per-key statistics of request and custom samples (08).
import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../../../src/core/config/index.ts';
import type { PerfConfigInput, ResolvedConfig } from '../../../src/core/config/index.ts';
import { stringifyStable } from '../../../src/core/format/index.ts';
import { hash53 } from '../../../src/core/random/index.ts';
import {
  createKeyBuilder,
  normalizationFingerprint,
  truncateKey,
} from '../../../src/core/normalize/index.ts';
import { buildRunReport } from '../../../src/core/report/index.ts';
import type { RunReportAggregates } from '../../../src/core/report/index.ts';
import { parseRunReport } from '../../../src/core/schema/index.ts';
import {
  Aggregator,
  BottomK,
  addKeyedRequest,
  percentile,
  resultId,
  sampleId,
  testIdentity,
} from '../../../src/core/stats/index.ts';
import type {
  AggregatorOptions,
  Aggregates,
  EnrichedCustomSample,
  EnrichedRequestSample,
  TestMeta,
} from '../../../src/core/stats/index.ts';
import type { KeyEvaluation, RunReport } from '../../../src/core/types/index.ts';
import { loadCases } from '../../contract/golden.ts';

// ---------------------------------------------------------------------------------------------
// Fixtures

function config(input: PerfConfigInput = {}): ResolvedConfig {
  const result = resolveConfig(input, {});
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value.config;
}

const DEFAULTS = config();

function options(
  overrides: Partial<AggregatorOptions> = {},
  cfg: ResolvedConfig = DEFAULTS,
): AggregatorOptions {
  return {
    advanced: cfg.advanced,
    successStatuses: cfg.measure.successStatuses,
    errors: { statuses: cfg.checks.errors.statuses },
    measuredProjects: new Set(['chromium']),
    evaluatedPercentile: cfg.checks.time.percentile.level,
    rawUrls: cfg.report.rawUrls,
    ...overrides,
  };
}

interface MetaInput {
  testId?: string;
  title?: string;
  project?: string;
  file?: string;
  line?: number;
  repeatEachIndex?: number;
  retry?: number;
  failed?: boolean;
}

function meta(input: MetaInput = {}): TestMeta {
  const title = input.title ?? 'suite › loads tickets';
  const project = input.project ?? 'chromium';
  const file = input.file ?? 'tests/tickets.spec.ts';
  const repeatEachIndex = input.repeatEachIndex ?? 0;
  return {
    identity: testIdentity(project, file, title),
    resultId: resultId(input.testId ?? `${file}:${title}`, repeatEachIndex, input.retry ?? 0),
    title,
    project,
    file,
    line: input.line ?? 10,
    repeatEachIndex,
    failed: input.failed ?? false,
  };
}

const START = Date.UTC(2026, 10, 18, 10, 0, 0, 0);

function req(
  input: Partial<Omit<EnrichedRequestSample, 'test'>> & { test?: TestMeta } = {},
): EnrichedRequestSample {
  return {
    method: 'GET',
    url: 'https://app.example/api/tickets/1',
    resourceType: 'fetch',
    status: 200,
    startTime: START,
    duration: 100,
    requestStart: 1,
    ttfb: 50,
    timeSource: 'browser',
    fromServiceWorker: false,
    ordinal: 0,
    ...input,
    test: input.test ?? meta(),
  };
}

function custom(
  input: Partial<Omit<EnrichedCustomSample, 'test'>> & { test?: TestMeta } = {},
): EnrichedCustomSample {
  return {
    name: 'render list',
    outcome: 'ok',
    duration: 100,
    endTime: START + 1000,
    ordinal: 0,
    ...input,
    test: input.test ?? meta(),
  };
}

const ORIGIN = 'https://app.example';
const KEY = 'GET /api/tickets/:id';

function add(
  agg: Aggregator,
  sample: EnrichedRequestSample,
  key = KEY,
  browserName: string | null = 'chromium',
): void {
  agg.addRequest(key, sample, ORIGIN, '', browserName);
}

/** mulberry32: deterministic test data. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const random = rng(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Demo-like skewed durations rounded to 0.1 ms. */
function demoDuration(random: () => number): number {
  const u = random();
  return Math.round((40 + 400 * u * u * u + 30 * random()) * 10) / 10;
}

type Op =
  | { kind: 'request'; key: string; sample: EnrichedRequestSample; origin: string | null }
  | { kind: 'custom'; name: string; sample: EnrichedCustomSample };

/** A seeded run: several tests and keys, mixed statuses, time sources and outcomes. */
function demoRun(seed: number, samplesPerResult = 40): Op[] {
  const random = rng(seed);
  const ops: Op[] = [];
  const keys = ['GET /api/tickets/:id', 'POST /api/orders', 'GET /api/users?page'];
  const statuses: EnrichedRequestSample['status'][] = [200, 200, 200, 200, 304, 404, 500, 'FAILED'];
  for (let t = 0; t < 4; t++) {
    for (let repeat = 0; repeat < 3; repeat++) {
      const test = meta({
        title: `test ${t}`,
        file: `tests/t${t % 2}.spec.ts`,
        line: 10 + t,
        repeatEachIndex: repeat,
        failed: t === 3,
      });
      for (let i = 0; i < samplesPerResult; i++) {
        const status = statuses[Math.floor(random() * statuses.length)] ?? 200;
        ops.push({
          kind: 'request',
          key: keys[Math.floor(random() * keys.length)] ?? KEY,
          origin: random() < 0.1 ? null : ORIGIN,
          sample: req({
            test,
            ordinal: i,
            status,
            ...(status === 'FAILED'
              ? { failureText: random() < 0.5 ? 'net::ERR_ABORTED' : 'net::ERR_FAILED' }
              : {}),
            duration: status === 'FAILED' ? null : demoDuration(random),
            ttfb: random() < 0.2 ? null : Math.round(random() * 500) / 10,
            timeSource: random() < 0.05 ? 'node' : 'browser',
            startTime: START + Math.floor(random() * 100000),
          }),
        });
      }
      for (let i = 0; i < 5; i++) {
        const outcome = (['ok', 'ok', 'ok', 'error', 'unfinished'] as const)[i] ?? 'ok';
        ops.push({
          kind: 'custom',
          name: i % 2 === 0 ? 'render list' : 'open dialog',
          sample: custom({
            test,
            ordinal: i,
            outcome,
            duration: outcome === 'unfinished' ? null : demoDuration(random),
            endTime: outcome === 'unfinished' ? null : START + Math.floor(random() * 100000),
          }),
        });
      }
    }
  }
  return ops;
}

function run(ops: readonly Op[], opts: AggregatorOptions = options()): Aggregates {
  const agg = new Aggregator(opts);
  for (const op of ops) {
    if (op.kind === 'request') {
      agg.addRequest(op.key, op.sample, op.origin, op.origin === null ? null : '', 'chromium');
    } else {
      agg.addCustom(op.name, op.sample);
    }
  }
  return agg.finalize();
}

// ---------------------------------------------------------------------------------------------

describe('Aggregator: classification and counters (08, chapter 3)', () => {
  test('a successful browser-timed sample enters the time statistics', () => {
    const agg = new Aggregator(options());
    add(agg, req({ duration: 120.5, ttfb: 30.1 }));
    const result = agg.finalize();
    const a = result.endpoints[KEY];
    expect(a).toMatchObject({
      count: 1,
      successCount: 1,
      errorCount: 0,
      fromFailedTests: 0,
      testCount: 1,
      statuses: { '200': 1 },
      timeSources: { browser: 1, node: 0 },
      stats: {
        min: 120.5,
        avg: 120.5,
        max: 120.5,
        percentiles: { p50: 120.5, p90: 120.5, p95: 120.5, p99: 120.5 },
      },
      ttfb: { p50: 30.1, p95: 30.1 },
      samples: { durations: [120.5], sampled: false },
    });
    expect(result.issues).toEqual([]);
  });

  test('08-AC-06 a node-timed sample counts in count, statuses and timeSources only', () => {
    const agg = new Aggregator(options());
    add(agg, req({ duration: 100 }));
    add(agg, req({ ordinal: 1, duration: 900, timeSource: 'node' }));
    const a = agg.finalize().endpoints[KEY];
    expect(a?.count).toBe(2);
    expect(a?.statuses).toEqual({ '200': 2 });
    expect(a?.timeSources).toEqual({ browser: 1, node: 1 });
    expect(a?.successCount).toBe(1);
    expect(a?.stats?.max).toBe(100);
    expect(a?.samples.durations).toEqual([100]);
    expect(a?.slowest.map((s) => s.duration)).toEqual([100]);
  });

  test('08-AC-13 node-timed and service-worker samples give one warning counting only the node one', () => {
    const agg = new Aggregator(options());
    add(agg, req({ timeSource: 'node' }));
    add(agg, req({ ordinal: 1, fromServiceWorker: true, duration: 0.4 }));
    const result = agg.finalize();
    const a = result.endpoints[KEY];
    expect(a?.count).toBe(2);
    expect(a?.statuses).toEqual({ '200': 2 });
    expect(a?.successCount).toBe(0);
    const warnings = result.issues.filter((i) => i.code === 'STATS_SAMPLES_WITHOUT_BROWSER_TIMING');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toMatch(/^1 successful request sample in 1 endpoint key /);
  });

  test('a successful sample without duration counts but has no time statistics', () => {
    const agg = new Aggregator(options());
    add(agg, req({ duration: null, ttfb: null }));
    const a = agg.finalize().endpoints[KEY];
    expect(a).toMatchObject({ count: 1, successCount: 0, stats: null, statuses: { '200': 1 } });
  });

  test('08-AC-09 ABORTED is not an error by default; 500 and PENDING are; ABORTED in statuses counts', () => {
    const samples = [
      req({ status: 'FAILED', failureText: 'net::ERR_ABORTED', duration: null }),
      req({ ordinal: 1, status: 500, duration: 30 }),
      req({ ordinal: 2, status: 'PENDING', duration: null }),
      req({ ordinal: 3, status: 404, duration: 20 }),
      req({ ordinal: 4, status: 'FAILED', failureText: 'net::ERR_FAILED', duration: null }),
    ];
    const byDefault = new Aggregator(options());
    for (const s of samples) add(byDefault, s);
    const a = byDefault.finalize().endpoints[KEY];
    expect(a?.statuses).toEqual({ '404': 1, '500': 1, ABORTED: 1, FAILED: 1, PENDING: 1 });
    expect(a?.errorCount).toBe(3);
    expect(a?.successCount).toBe(0);
    expect(a?.stats).toBeNull();

    const withAborted = new Aggregator(
      options({ errors: { statuses: ['5xx', 'FAILED', 'PENDING', 'ABORTED'] } }),
    );
    for (const s of samples) add(withAborted, s);
    expect(withAborted.finalize().endpoints[KEY]?.errorCount).toBe(4);
  });

  test('exact error codes and success statuses come from the options', () => {
    const agg = new Aggregator(
      options({ successStatuses: ['200'], errors: { statuses: ['429'] } }),
    );
    add(agg, req({ status: 204 }));
    add(agg, req({ ordinal: 1, status: 429 }));
    add(agg, req({ ordinal: 2, status: 500 }));
    add(agg, req({ ordinal: 3, status: 200 }));
    const a = agg.finalize().endpoints[KEY];
    expect(a?.successCount).toBe(1);
    expect(a?.errorCount).toBe(1);
  });

  test('a key with only failures has successCount 0 and empty time fields (08-REQ-19)', () => {
    const agg = new Aggregator(options());
    for (let i = 0; i < 3; i++) add(agg, req({ ordinal: i, status: 503, duration: 10 }));
    const a = agg.finalize().endpoints[KEY];
    expect(a).toMatchObject({
      count: 3,
      successCount: 0,
      errorCount: 3,
      stats: null,
      ttfb: null,
      slowest: [],
      samples: { durations: [], sampled: false },
    });
    expect(a?.topTests).toHaveLength(1);
  });

  test('custom outcomes: ok enters statistics, error and unfinished are errors (08-REQ-04)', () => {
    const agg = new Aggregator(options());
    agg.addCustom('render list', custom({ duration: 50 }));
    agg.addCustom('render list', custom({ ordinal: 1, outcome: 'error', duration: 9000 }));
    agg.addCustom(
      'render list',
      custom({ ordinal: 2, outcome: 'unfinished', duration: null, endTime: null }),
    );
    const a = agg.finalize().custom['render list'];
    expect(a).toMatchObject({
      count: 3,
      successCount: 1,
      errorCount: 2,
      statuses: { ok: 1, error: 1, unfinished: 1 },
      timeSources: { browser: 0, node: 3 },
      ttfb: null,
      samples: { durations: [50], sampled: false },
    });
    expect(a?.stats?.max).toBe(50);
  });

  test('percentiles include the evaluated level when it is another one (08-REQ-10)', () => {
    const agg = new Aggregator(options({ evaluatedPercentile: 'p97.5' }));
    [100, 200, 300, 400, 500].forEach((d, i) => add(agg, req({ ordinal: i, duration: d })));
    expect(agg.finalize().endpoints[KEY]?.stats?.percentiles).toEqual({
      p50: 300,
      p90: 460,
      p95: 480,
      'p97.5': 490,
      p99: 496,
    });
  });

  test('TTFB uses only retained usable samples with a TTFB (08-REQ-17)', () => {
    const agg = new Aggregator(options());
    add(agg, req({ ttfb: 10 }));
    add(agg, req({ ordinal: 1, ttfb: null }));
    add(agg, req({ ordinal: 2, ttfb: 30 }));
    add(agg, req({ ordinal: 3, status: 500, ttfb: 999 }));
    expect(agg.finalize().endpoints[KEY]?.ttfb).toEqual({ p50: 20, p95: 29 });
  });

  test('no usable sample with a TTFB gives ttfb null', () => {
    const agg = new Aggregator(options());
    add(agg, req({ ttfb: null }));
    expect(agg.finalize().endpoints[KEY]?.ttfb).toBeNull();
  });
});

describe('Aggregator: tests, slowest and origins (08, chapters 4 and 7)', () => {
  test('08-AC-07 testCount counts repetitions once; fromFailedTests counts samples of failed tests', () => {
    const agg = new Aggregator(options());
    for (let repeat = 0; repeat < 3; repeat++) {
      add(agg, req({ test: meta({ repeatEachIndex: repeat }) }));
    }
    // A retry of the same test is the same test, too.
    add(agg, req({ test: meta({ retry: 1, failed: true }), status: 500 }));
    add(agg, req({ test: meta({ retry: 1, failed: true }), ordinal: 1 }));
    // A test marked with test.fail() that failed is not failed (isFailedTest → false).
    add(agg, req({ test: meta({ title: 'expected to fail', failed: false }) }));
    const a = agg.finalize().endpoints[KEY];
    expect(a?.testCount).toBe(2);
    expect(a?.fromFailedTests).toBe(2);
    expect(a?.successCount).toBe(5);
  });

  test('08-AC-11 topTests: at most 5, by sample count, ties by file, line, title, project', () => {
    const agg = new Aggregator(options());
    const tests: [MetaInput, number][] = [
      [{ title: 'a', file: 'tests/b.spec.ts', line: 1 }, 4],
      [{ title: 'b', file: 'tests/a.spec.ts', line: 9 }, 4],
      [{ title: 'c', file: 'tests/a.spec.ts', line: 3 }, 4],
      [{ title: 'z', file: 'tests/a.spec.ts', line: 3, project: 'chromium' }, 2],
      [{ title: 'y', file: 'tests/a.spec.ts', line: 3, project: 'chromium' }, 2],
      [{ title: 'x', file: 'tests/c.spec.ts', line: 3 }, 1],
      [{ title: 'many', file: 'tests/z.spec.ts', line: 99 }, 7],
    ];
    const ops: EnrichedRequestSample[] = [];
    for (const [input, n] of tests) {
      for (let i = 0; i < n; i++) {
        // Spread over two repetitions and a non-success status: all samples count.
        ops.push(
          req({
            test: meta({ ...input, repeatEachIndex: i % 2 }),
            ordinal: i,
            status: i === 0 ? 500 : 200,
          }),
        );
      }
    }
    for (const s of shuffle(ops, 7)) add(agg, s);
    const a = agg.finalize().endpoints[KEY];
    expect(a?.testCount).toBe(7);
    expect(a?.topTests).toEqual([
      { title: 'many', project: 'chromium', file: 'tests/z.spec.ts', line: 99, sampleCount: 7 },
      { title: 'c', project: 'chromium', file: 'tests/a.spec.ts', line: 3, sampleCount: 4 },
      { title: 'b', project: 'chromium', file: 'tests/a.spec.ts', line: 9, sampleCount: 4 },
      { title: 'a', project: 'chromium', file: 'tests/b.spec.ts', line: 1, sampleCount: 4 },
      { title: 'y', project: 'chromium', file: 'tests/a.spec.ts', line: 3, sampleCount: 2 },
    ]);
  });

  test('08-AC-11 slowest: 3 slowest of all usable samples, ties by file, line, repeatEachIndex, ordinal', () => {
    const agg = new Aggregator(options({ advanced: { maxSamplesPerKey: 2, seed: 1 } }));
    const samples = [
      req({ test: meta({ file: 'tests/b.spec.ts' }), duration: 500, startTime: START + 1 }),
      req({
        test: meta({ file: 'tests/a.spec.ts', line: 20 }),
        duration: 500,
        startTime: START + 2,
      }),
      req({
        test: meta({ file: 'tests/a.spec.ts', line: 5, repeatEachIndex: 1 }),
        duration: 500,
        ordinal: 0,
      }),
      req({
        test: meta({ file: 'tests/a.spec.ts', line: 5, repeatEachIndex: 0 }),
        duration: 500,
        ordinal: 7,
        startTime: START + 3,
      }),
      req({
        test: meta({ file: 'tests/a.spec.ts', line: 5, repeatEachIndex: 0 }),
        duration: 500,
        ordinal: 3,
        startTime: START + 4,
      }),
      req({ ordinal: 50, duration: 900, status: 500 }),
      req({ ordinal: 51, duration: 950, timeSource: 'node' }),
      ...Array.from({ length: 20 }, (_, i) => req({ ordinal: 100 + i, duration: 10 + i })),
    ];
    for (const s of shuffle(samples, 3)) add(agg, s);
    const a = agg.finalize().endpoints[KEY];
    expect(a?.slowest).toEqual([
      {
        duration: 500,
        startedAt: new Date(START + 4).toISOString(),
        test: {
          title: 'suite › loads tickets',
          project: 'chromium',
          file: 'tests/a.spec.ts',
          line: 5,
          repeatEachIndex: 0,
        },
      },
      {
        duration: 500,
        startedAt: new Date(START + 3).toISOString(),
        test: {
          title: 'suite › loads tickets',
          project: 'chromium',
          file: 'tests/a.spec.ts',
          line: 5,
          repeatEachIndex: 0,
        },
      },
      {
        duration: 500,
        startedAt: new Date(START).toISOString(),
        test: {
          title: 'suite › loads tickets',
          project: 'chromium',
          file: 'tests/a.spec.ts',
          line: 5,
          repeatEachIndex: 1,
        },
      },
    ]);
    // Exact over all samples although only 2 are retained.
    expect(a?.samples.durations).toHaveLength(2);
    expect(a?.stats?.max).toBe(500);
  });

  test('08-AC-11 slowest custom sample starts at endTime − duration rounded to whole ms', () => {
    const agg = new Aggregator(options());
    agg.addCustom('render list', custom({ duration: 123.4, endTime: START + 1000 }));
    const slowest = agg.finalize().custom['render list']?.slowest;
    expect(slowest?.[0]?.startedAt).toBe(new Date(START + 877).toISOString());
    expect(slowest?.[0]?.startedAt).toBe('2026-11-18T10:00:00.877Z');
  });

  test('slowest[].url only for endpoints and only with rawUrls', () => {
    const off = new Aggregator(options());
    add(off, req());
    expect(off.finalize().endpoints[KEY]?.slowest[0]).not.toHaveProperty('url');
    const on = new Aggregator(options({ rawUrls: true }));
    add(on, req());
    on.addCustom('render list', custom());
    const result = on.finalize();
    expect(result.endpoints[KEY]?.slowest[0]?.url).toBe('https://app.example/api/tickets/1');
    expect(result.custom['render list']?.slowest[0]).not.toHaveProperty('url');
  });

  test('origins: request count per origin with its label, sorted; unknown origin excluded (08-REQ-33)', () => {
    const agg = new Aggregator(options());
    agg.addRequest('GET api /v1', req(), 'https://api.example', 'api', 'chromium');
    agg.addRequest(KEY, req({ ordinal: 1, status: 500 }), ORIGIN, '', 'chromium');
    agg.addRequest(KEY, req({ ordinal: 2 }), ORIGIN, '', 'chromium');
    agg.addRequest('custom key', req({ ordinal: 3 }), null, null, 'chromium');
    const result = agg.finalize();
    expect(result.origins).toEqual([
      { origin: 'https://api.example', label: 'api', requestCount: 1 },
      { origin: 'https://app.example', label: '', requestCount: 2 },
    ]);
    expect(result.endpoints['custom key']?.count).toBe(1);
  });

  test('addKeyedRequest adds a sample under the key built by normalize and skips skipped URLs', () => {
    const agg = new Aggregator(options());
    const keyOf = createKeyBuilder(DEFAULTS.keys, { baseOrigins: [ORIGIN] });
    expect(addKeyedRequest(agg, keyOf, req(), 'chromium').ok).toBe(true);
    const skipped = addKeyedRequest(
      agg,
      keyOf,
      req({ ordinal: 1, url: 'data:text/plain,x' }),
      'chromium',
    );
    expect(skipped.ok).toBe(false);
    const result = agg.finalize();
    expect(Object.keys(result.endpoints)).toEqual(['GET /api/tickets/:id']);
    expect(result.origins).toEqual([{ origin: ORIGIN, label: '', requestCount: 1 }]);
  });
});

describe('Aggregator: run-level warnings (08-REQ-31, 08-REQ-32)', () => {
  test('08-AC-10 samples of dependency projects enter no aggregate and give one warning', () => {
    const agg = new Aggregator(options());
    const setup = meta({ project: 'setup', title: 'log in' });
    add(agg, req({ test: setup }), 'POST /api/login');
    add(agg, req({ test: setup, ordinal: 1 }), KEY);
    agg.addCustom('login', custom({ test: setup }));
    add(agg, req({ ordinal: 2 }), KEY);
    const result = agg.finalize();
    expect(Object.keys(result.endpoints)).toEqual([KEY]);
    expect(result.endpoints[KEY]?.count).toBe(1);
    expect(result.custom).toEqual({});
    expect(result.origins).toEqual([{ origin: ORIGIN, label: '', requestCount: 1 }]);
    const warnings = result.issues.filter(
      (i) => i.code === 'STATS_SAMPLES_OUTSIDE_MEASURED_PROJECTS',
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toMatch(/^3 samples /);
    expect(warnings[0]?.message).toContain('setup');
  });

  test('08-AC-12 batches from chromium and firefox give one warning naming both', () => {
    const agg = new Aggregator(options({ measuredProjects: new Set(['chromium', 'firefox']) }));
    add(agg, req(), KEY, 'firefox');
    add(agg, req({ ordinal: 1 }), KEY, 'chromium');
    add(agg, req({ ordinal: 2 }), KEY, 'firefox');
    const warnings = agg.finalize().issues.filter((i) => i.code === 'STATS_MULTIPLE_BROWSERS');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('chromium, firefox');
  });

  test('08-AC-12 batches from one browser give no warning', () => {
    const agg = new Aggregator(options());
    add(agg, req(), KEY, 'chromium');
    add(agg, req({ ordinal: 1 }), KEY, 'chromium');
    add(agg, req({ ordinal: 2 }), KEY, null);
    expect(agg.finalize().issues).toEqual([]);
  });
});

describe('Aggregator: sampling and determinism (08, chapters 6, 7 and 9)', () => {
  /** Reference bottom-k: the k smallest (priority, sampleId) of all usable samples. */
  function referenceRetained(ops: readonly Op[], key: string, k: number, seed: number): number[] {
    const usable = ops.flatMap((op) =>
      op.kind === 'request' &&
      op.key === key &&
      typeof op.sample.status === 'number' &&
      op.sample.status < 400 &&
      op.sample.timeSource === 'browser' &&
      op.sample.duration !== null
        ? [op.sample]
        : [],
    );
    return usable
      .map((s) => {
        const id = sampleId(s.test.resultId, 'request', s.ordinal);
        return { id, p: hash53(`${key}\u0000${id}`, seed), d: s.duration ?? 0 };
      })
      .sort((a, b) => a.p - b.p || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, k)
      .map((x) => x.d)
      .sort((a, b) => a - b);
  }

  test('08-AC-03 shuffling the order of the same samples gives an identical finalize()', () => {
    const ops = demoRun(11);
    const opts = options({ advanced: { maxSamplesPerKey: 25, seed: 1 } });
    const expected = stringifyStable(run(ops, opts));
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(stringifyStable(run(shuffle(ops, seed), opts))).toBe(expected);
    }
    expect(stringifyStable(run([...ops].reverse(), opts))).toBe(expected);
  });

  test('08-AC-04 samples of another key do not change the retained samples of a key', () => {
    const ops = demoRun(12).filter((op) => op.kind === 'request');
    const opts = options({ advanced: { maxSamplesPerKey: 10, seed: 1 } });
    const only = ops.filter((op) => op.kind === 'request' && op.key === KEY);
    const alone = run(only, opts).endpoints[KEY];
    const mixed = run(ops, opts).endpoints[KEY];
    expect(alone?.samples.sampled).toBe(true);
    expect(mixed?.samples).toEqual(alone?.samples);
    expect(mixed).toEqual(alone);
  });

  test('retained samples are the bottom-k by hash53(key + NUL + sampleId, seed) (08-REQ-12)', () => {
    const ops = demoRun(13);
    for (const seed of [1, 99]) {
      const result = run(ops, options({ advanced: { maxSamplesPerKey: 15, seed } }));
      for (const key of ['GET /api/tickets/:id', 'POST /api/orders']) {
        expect(result.endpoints[key]?.samples.durations, `${key} seed ${seed}`).toEqual(
          referenceRetained(ops, key, 15, seed),
        );
      }
    }
  });

  test('08-AC-15 a different advanced.seed changes the retained samples, not keys or fingerprint', () => {
    const ops = demoRun(14);
    const a = run(ops, options({ advanced: { maxSamplesPerKey: 15, seed: 1 } }));
    const b = run(ops, options({ advanced: { maxSamplesPerKey: 15, seed: 2 } }));
    expect(b.endpoints[KEY]?.samples.durations).not.toEqual(a.endpoints[KEY]?.samples.durations);
    expect(b.endpoints[KEY]?.count).toBe(a.endpoints[KEY]?.count);

    const one = config({ advanced: { seed: 1 } });
    const two = config({ advanced: { seed: 2 } });
    const ctx = { baseOrigins: [ORIGIN] };
    expect(normalizationFingerprint(two.keys, ctx)).toBe(normalizationFingerprint(one.keys, ctx));
    const urlOf = `${ORIGIN}/${'segment/'.repeat(400)}`;
    const keyOne = createKeyBuilder(
      one.keys,
      ctx,
    )({ method: 'GET', url: urlOf, resourceType: 'fetch' });
    const keyTwo = createKeyBuilder(
      two.keys,
      ctx,
    )({ method: 'GET', url: urlOf, resourceType: 'fetch' });
    expect(keyOne.ok && keyOne.key.includes('…~')).toBe(true);
    expect(keyOne.ok && truncateKey(keyOne.key)).toBe(keyOne.ok && keyOne.key);
    expect(keyTwo).toEqual(keyOne);
  });

  test('08-AC-05 with 50 000 samples of one key exactly maxSamplesPerKey durations are kept', () => {
    const agg = new Aggregator(options());
    const random = rng(5);
    const durations: number[] = [];
    const test = meta();
    for (let i = 0; i < 50_000; i++) {
      const d = demoDuration(random);
      durations.push(d);
      add(agg, req({ test, ordinal: i, duration: d }));
    }
    const a = agg.finalize().endpoints[KEY];
    expect(a?.samples.durations).toHaveLength(DEFAULTS.advanced.maxSamplesPerKey);
    expect(a?.samples.sampled).toBe(true);
    expect(a?.count).toBe(50_000);
    expect(a?.successCount).toBe(50_000);
    expect(a?.stats?.min).toBe(Math.min(...durations));
    expect(a?.stats?.max).toBe(Math.max(...durations));
    const sumTenths = durations.reduce((s, d) => s + Math.round(d * 10), 0);
    expect(a?.stats?.avg).toBe(Math.round(sumTenths / 50_000) / 10);
  });

  test('sampled is true exactly when successCount exceeds maxSamplesPerKey (08-REQ-20)', () => {
    for (const n of [3, 4]) {
      const agg = new Aggregator(options({ advanced: { maxSamplesPerKey: 3, seed: 1 } }));
      for (let i = 0; i < n; i++) add(agg, req({ ordinal: i, duration: 10 * (i + 1) }));
      add(agg, req({ ordinal: 99, status: 500 }));
      const a = agg.finalize().endpoints[KEY];
      expect(a?.samples.sampled).toBe(n > 3);
      expect(a?.samples.durations).toHaveLength(3);
    }
  });

  test('percentiles come from the retained durations; exact when not sampled (08-REQ-11)', () => {
    const ops = demoRun(15);
    const result = run(ops);
    for (const [key, a] of Object.entries(result.endpoints)) {
      expect(a.samples.sampled, key).toBe(false);
      const sorted = a.samples.durations;
      expect(a.stats?.percentiles.p95, key).toBe(
        Math.round((percentile(sorted, 95) ?? 0) * 10) / 10,
      );
      expect(a.stats?.min).toBe(sorted[0]);
      expect(a.stats?.max).toBe(sorted.at(-1));
    }
  });

  test('08-AC-14 the average of 0.1, 0.2 and 0.3 is exactly 0.2 in any order', () => {
    const orders = [
      [0.1, 0.2, 0.3],
      [0.3, 0.2, 0.1],
      [0.2, 0.3, 0.1],
    ];
    for (const order of orders) {
      const agg = new Aggregator(options());
      order.forEach((d, i) => add(agg, req({ ordinal: i, duration: d })));
      expect(agg.finalize().endpoints[KEY]?.stats?.avg).toBe(0.2);
    }
  });

  test('08-AC-14 the average of 10 000 random durations is identical for every permutation', () => {
    const random = rng(21);
    const samples = Array.from({ length: 10_000 }, (_, i) =>
      req({ ordinal: i, duration: Math.round(random() * 1e6) / 10 }),
    );
    const averages = new Set<number | undefined>();
    for (const seed of [1, 2, 3]) {
      const agg = new Aggregator(options());
      for (const s of shuffle(samples, seed)) add(agg, s);
      averages.add(agg.finalize().endpoints[KEY]?.stats?.avg);
    }
    expect(averages.size).toBe(1);
  });

  test('finalize() may be called once', () => {
    const agg = new Aggregator(options());
    agg.finalize();
    expect(() => agg.finalize()).toThrow(/once/);
    expect(() => add(agg, req())).toThrow(/finalize/);
  });

  test('keys of endpoints and custom are sorted by UTF-16 code units (08-REQ-26)', () => {
    const agg = new Aggregator(options());
    for (const [i, key] of ['b', 'B', 'a', 'é'].entries()) add(agg, req({ ordinal: i }), key);
    expect(Object.keys(agg.finalize().endpoints)).toEqual(['B', 'a', 'b', 'é']);
  });
});

describe('BottomK (08-REQ-12, 08-REQ-28)', () => {
  test('ties of the priority are broken by sampleId in UTF-16 order, never localeCompare', () => {
    const ids = ['b', 'B', 'a', 'A'];
    for (const order of [
      [0, 1, 2, 3],
      [3, 2, 1, 0],
      [2, 0, 3, 1],
    ]) {
      const heap = new BottomK(2, (r) => ids[r] ?? '');
      for (const r of order) heap.add(7, r * 10, -1, r, 0);
      // Code unit order: 'A' < 'B' < 'a' < 'b'.
      expect(heap.durations()).toEqual([10, 30]);
    }
  });

  test('keeps the smallest priorities and their TTFB', () => {
    const heap = new BottomK(3, (r) => String(r));
    const priorities = [50, 10, 40, 20, 30, 60];
    priorities.forEach((p, i) => heap.add(p, p * 10, i === 1 ? -1 : p, i, 0));
    expect(heap.durations()).toEqual([100, 200, 300]);
    expect(heap.ttfbs()).toEqual([20, 30]);
    expect(heap.size).toBe(3);
  });
});

describe('Aggregator output fits buildRunReport (02, chapter 9.1)', () => {
  test('finalize() of a demo run builds a valid run report', () => {
    const found = loadCases('run-report').find(
      (c) => c.dir === 'valid' && c.file === 'full-run.json',
    );
    if (found === undefined) throw new Error('golden full-run.json');
    const report = structuredClone(found.input) as RunReport;
    const evaluation = Object.values(report.endpoints)[0]?.evaluation as KeyEvaluation;
    const aggregates: RunReportAggregates = run(demoRun(16), options({ rawUrls: true }));
    const perKey = (record: Record<string, unknown>) =>
      Object.fromEntries(Object.keys(record).map((key) => [key, evaluation]));
    const { endpoints, custom: customAggregates, evaluation: summary, ...rest } = report;
    void endpoints;
    void customAggregates;
    const built = buildRunReport({
      meta: rest,
      config: { ...report.config, report: { ...report.config.report, rawUrls: true } },
      normalization: report.normalization,
      runConditions: report.runConditions,
      tests: report.tests,
      aggregates,
      evaluation: {
        ...summary,
        perKey: { api: perKey(aggregates.endpoints), custom: perKey(aggregates.custom) },
        thresholdFiles: report.thresholdFiles,
      },
      warnings: [],
      toolErrors: [],
    });
    const parsed = parseRunReport(stringifyStable(built), 'demo');
    expect(parsed.ok ? [] : parsed.issues).toEqual([]);
    // The report keeps the aggregator's values and order.
    expect(built.endpoints[KEY]?.slowest).toEqual(aggregates.endpoints[KEY]?.slowest);
    expect(built.endpoints[KEY]?.topTests).toEqual(aggregates.endpoints[KEY]?.topTests);
  });
});
