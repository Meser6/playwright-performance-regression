// Data of the aggregator for the HTML report (08, chapter 7.1): histogram, ttfb.otherP50,
// per-test costs and the waterfall of the slowest test runs.
import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../../../src/core/config/index.ts';
import {
  Aggregator,
  HISTOGRAM_MANTISSAS,
  histogram,
  histogramEdge,
  resultId,
  testIdentity,
} from '../../../src/core/stats/index.ts';
import type {
  AggregatorOptions,
  EnrichedRequestSample,
  TestMeta,
} from '../../../src/core/stats/index.ts';
import type { RunReport } from '../../../src/core/types/index.ts';
import { loadCases } from '../../contract/golden.ts';

const resolved = resolveConfig({}, {});
if (!resolved.ok) throw new Error(JSON.stringify(resolved.issues));
const CONFIG = resolved.value.config;

function options(overrides: Partial<AggregatorOptions> = {}): AggregatorOptions {
  return {
    advanced: CONFIG.advanced,
    successStatuses: CONFIG.measure.successStatuses,
    errors: { statuses: CONFIG.checks.errors.statuses },
    measuredProjects: new Set(['chromium']),
    evaluatedPercentile: CONFIG.checks.time.percentile.level,
    rawUrls: false,
    ...overrides,
  };
}

const START = Date.UTC(2026, 10, 18, 10, 0, 0, 0);
const ORIGIN = 'https://app.example';

interface MetaInput {
  title?: string;
  project?: string;
  file?: string;
  line?: number;
  repeatEachIndex?: number;
  retry?: number;
  startTime?: number;
}

function meta(input: MetaInput = {}): TestMeta {
  const title = input.title ?? 'suite › loads tickets';
  const project = input.project ?? 'chromium';
  const file = input.file ?? 'tests/tickets.spec.ts';
  const repeatEachIndex = input.repeatEachIndex ?? 0;
  const retry = input.retry ?? 0;
  return {
    identity: testIdentity(project, file, title),
    resultId: resultId(`${file}:${title}`, repeatEachIndex, retry),
    title,
    project,
    file,
    line: input.line ?? 10,
    repeatEachIndex,
    retry,
    failed: false,
    startTime: input.startTime ?? START,
  };
}

function req(
  test: TestMeta,
  ordinal: number,
  input: Partial<Omit<EnrichedRequestSample, 'test' | 'ordinal'>> = {},
): EnrichedRequestSample {
  return {
    method: 'GET',
    url: 'https://app.example/api/tickets/1',
    resourceType: 'fetch',
    status: 200,
    startTime: test.startTime + 10 * ordinal,
    duration: 100,
    requestStart: 1,
    ttfb: 50,
    timeSource: 'browser',
    fromServiceWorker: false,
    ...input,
    ordinal,
    test,
  };
}

interface Result {
  meta: TestMeta;
  requests: { key: string; sample: EnrichedRequestSample }[];
  custom?: number;
}

/** Feeds results to an aggregator the way the reporter does: samples, then endResult. */
function aggregate(results: readonly Result[], opts = options()) {
  const agg = new Aggregator(opts);
  for (const r of results) {
    for (const { key, sample } of r.requests) agg.addRequest(key, sample, ORIGIN, '', 'chromium');
    for (let i = 0; i < (r.custom ?? 0); i++) {
      agg.addCustom('render', {
        name: 'render',
        outcome: 'ok',
        endTime: r.meta.startTime + 30,
        duration: 30,
        ordinal: i,
        test: r.meta,
      });
    }
    agg.endResult(r.meta);
  }
  return agg.finalize();
}

function shuffle<T>(items: readonly T[], seed: number): T[] {
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

describe('histogram (08-REQ-34)', () => {
  test('08-AC-18 the mantissa table equals round(1000 · 10^(k/48))', () => {
    expect(HISTOGRAM_MANTISSAS).toHaveLength(48);
    // Math.pow is fine in a test: the table is the documented constant it must match.
    HISTOGRAM_MANTISSAS.forEach((m, k) =>
      expect(m, String(k)).toBe(Math.round(1000 * 10 ** (k / 48))),
    );
    expect(histogramEdge(0)).toBe(1);
    expect(histogramEdge(48 + 34)).toBe(51.09);
    expect(histogramEdge(3 * 48 + 4)).toBe(1212);
  });

  test('08-AC-18 [52, 180, 181, 190, 950, 1100] gives 22 bins with f = 3', () => {
    const h = histogram([52, 180, 181, 190, 950, 1100]);
    if (h === null) throw new Error('null');
    expect(h.counts).toHaveLength(22);
    expect(h.edges).toHaveLength(23);
    expect(h.edges[0]).toBe(51.09);
    expect(h.edges[22]).toBe(1212);
    expect([h.edges[8], h.edges[9]]).toEqual([161.6, 186.6]);
    const expected = new Array<number>(22).fill(0);
    expected[0] = 1;
    expected[8] = 2;
    expected[9] = 1;
    expected[20] = 1;
    expected[21] = 1;
    expect(h.counts).toEqual(expected);
    // f = 3: each edge is three steps of the scale after the previous one.
    for (let i = 0; i <= 22; i++) expect(h.edges[i]).toBe(histogramEdge(82 + 3 * i));
  });

  test('08-AC-18 equal durations give one bin; durations below 1 ms start at 0', () => {
    expect(histogram([200, 200, 200])).toEqual({ edges: [195.7, 205.4], counts: [3] });
    const small = histogram([0.4, 3.2, 12.5]);
    expect(small?.counts).toHaveLength(27);
    expect(small?.edges[0]).toBe(0);
    expect(small?.edges[1]).toBe(histogramEdge(2));
    expect(small?.counts.reduce((a, b) => a + b, 0)).toBe(3);
    expect(histogram([])).toBeNull();
    expect(histogram([0])).toEqual({ edges: [0, 1.049], counts: [1] });
  });

  test('08-AC-18 at most 30 bins, ascending edges and counts summing to n for wide ranges', () => {
    const wide = Array.from({ length: 500 }, (_, i) => Math.round((0.1 + i * i * 0.4) * 10) / 10);
    const h = histogram(wide);
    if (h === null) throw new Error('null');
    expect(h.counts.length).toBeLessThanOrEqual(30);
    expect(h.edges.length).toBe(h.counts.length + 1);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(500);
    for (let i = 1; i < h.edges.length; i++)
      expect(h.edges[i]).toBeGreaterThan(h.edges[i - 1] ?? 0);
    expect(h.edges.at(-1)).toBeGreaterThan(wide.at(-1) ?? 0);
  });

  test('08-AC-18 sum of counts equals samples.durations.length for every golden key; stats null has histogram null', () => {
    const cases = loadCases('run-report').filter((c) => c.dir === 'valid');
    let checked = 0;
    for (const c of cases) {
      const report = c.input as RunReport;
      for (const agg of [...Object.values(report.endpoints), ...Object.values(report.custom)]) {
        if (agg.stats === null) {
          expect(agg.histogram).toBeNull();
          continue;
        }
        expect(agg.histogram).toEqual(histogram(agg.samples.durations));
        expect(agg.histogram?.counts.reduce((a, b) => a + b, 0)).toBe(agg.samples.durations.length);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(2);
  });

  test('08-AC-18 the aggregator gives the histogram of the retained durations, null without stats', () => {
    const t = meta();
    const durations = [52, 180, 181, 190, 950, 1100];
    const out = aggregate([
      {
        meta: t,
        requests: [
          ...durations.map((d, i) => ({ key: 'GET /a', sample: req(t, i, { duration: d }) })),
          { key: 'GET /b', sample: req(t, 6, { status: 500 }) },
        ],
      },
    ]);
    expect(out.endpoints['GET /a']?.histogram).toEqual(histogram(durations));
    expect(out.endpoints['GET /b']?.stats).toBeNull();
    expect(out.endpoints['GET /b']?.histogram).toBeNull();
  });
});

describe('ttfb.otherP50 (08-REQ-35)', () => {
  test('08-AC-19 (100, 60), (200, 150), (50, 70) give otherP50 = 40', () => {
    const t = meta();
    const pairs = [
      [100, 60],
      [200, 150],
      [50, 70],
    ] as const;
    const out = aggregate([
      {
        meta: t,
        requests: pairs.map(([duration, ttfb], i) => ({
          key: 'GET /a',
          sample: req(t, i, { duration, ttfb }),
        })),
      },
    ]);
    expect(out.endpoints['GET /a']?.ttfb?.otherP50).toBe(40);
  });
});

describe('per-test costs (08-REQ-37)', () => {
  test('08-AC-20 two tests with 3 runs each (one run without requests) give executions, totals and top keys', () => {
    const a = (r: number) => meta({ title: 'a', line: 5, repeatEachIndex: r });
    const b = (r: number) =>
      meta({ title: 'b', file: 'tests/b.spec.ts', line: 7, repeatEachIndex: r });
    const results: Result[] = [];
    for (let r = 0; r < 3; r++) {
      const ta = a(r);
      results.push({
        meta: ta,
        requests:
          r === 2
            ? [] // an empty batch: counted in executions
            : [
                { key: 'GET /x', sample: req(ta, 0, { duration: 100.1 }) },
                { key: 'GET /y', sample: req(ta, 1, { duration: 50 }) },
                { key: 'GET /y', sample: req(ta, 2, { duration: 50.1 }) },
                { key: 'GET /z', sample: req(ta, 3, { status: 500 }) },
              ],
      });
      const tb = b(r);
      results.push({
        meta: tb,
        requests: [
          { key: 'GET /p', sample: req(tb, 0, { duration: 10 }) },
          { key: 'GET /q', sample: req(tb, 1, { duration: 10 }) },
        ],
      });
    }
    // A test with custom measurements only has no entry.
    results.push({ meta: meta({ title: 'custom only' }), requests: [], custom: 2 });
    const { testBreakdown } = aggregate(results);
    expect(testBreakdown.omitted).toBe(0);
    expect(testBreakdown.tests.map((t) => t.title)).toEqual(['a', 'b']);
    const [ta, tb] = testBreakdown.tests;
    expect(ta).toMatchObject({
      executions: 3,
      requestCount: 8,
      errorCount: 2,
      totalMs: 400.4,
      maxRequestMs: 100.1,
      keyCount: 3,
      keys: ['GET /x', 'GET /y', 'GET /z'],
    });
    // Equal totalMs: more samples first; GET /z has no time-usable request.
    expect(ta?.topKeys).toEqual([
      { key: 'GET /y', count: 4, totalMs: 200.2 },
      { key: 'GET /x', count: 2, totalMs: 200.2 },
      { key: 'GET /z', count: 2, totalMs: 0 },
    ]);
    // Equal totalMs and count: ties by key.
    expect(tb?.topKeys).toEqual([
      { key: 'GET /p', count: 3, totalMs: 30 },
      { key: 'GET /q', count: 3, totalMs: 30 },
    ]);
    expect(tb?.executions).toBe(3);
  });

  test('08-AC-20 tests are ordered by totalMs, requestCount, file, line, project, title; 501 tests give 500 and omitted 1', () => {
    const results: Result[] = [];
    for (let i = 0; i < 501; i++) {
      const t = meta({ title: `t${i}`, file: `tests/f${i % 3}.spec.ts`, line: i + 1 });
      results.push({
        meta: t,
        requests: [{ key: 'GET /a', sample: req(t, 0, { duration: 10 + (i % 4) }) }],
      });
    }
    const { testBreakdown } = aggregate(shuffle(results, 3));
    expect(testBreakdown.tests).toHaveLength(500);
    expect(testBreakdown.omitted).toBe(1);
    const order = testBreakdown.tests.map((t) => [t.totalMs, t.file, t.line]);
    const sorted = [...order].sort(
      (x, y) =>
        (y[0] as number) - (x[0] as number) ||
        String(x[1]).localeCompare(String(y[1])) ||
        (x[2] as number) - (y[2] as number),
    );
    expect(order).toEqual(sorted);
    expect(testBreakdown.tests[0]?.totalMs).toBe(13);
    expect(aggregate(results).testBreakdown).toEqual(testBreakdown);
  });

  test('08-REQ-36 results of projects that are not measured do not count', () => {
    const t = meta({ project: 'setup' });
    const { testBreakdown } = aggregate([
      { meta: t, requests: [{ key: 'GET /a', sample: req(t, 0) }] },
    ]);
    expect(testBreakdown).toEqual({ tests: [], omitted: 0, waterfalls: [] });
  });
});

describe('waterfall (08-REQ-38)', () => {
  /** Six tests, two runs each; test i has a run total of 100 · (i + 1) + 7 · run. */
  function runs(): Result[] {
    const results: Result[] = [];
    for (let i = 0; i < 6; i++) {
      for (let r = 0; r < 2; r++) {
        const t = meta({
          title: `test ${i}`,
          line: 10 + i,
          repeatEachIndex: r,
          startTime: START + 60_000 * (2 * i + r),
        });
        results.push({
          meta: t,
          requests: [
            { key: 'GET /a', sample: req(t, 0, { duration: 50 * (i + 1) + 7 * r }) },
            { key: 'GET /b', sample: req(t, 1, { duration: 50 * (i + 1) }) },
          ],
        });
      }
    }
    return results;
  }

  test('08-AC-21 the waterfalls do not depend on the order of the test results; one run per test', () => {
    const expected = aggregate(runs()).testBreakdown.waterfalls;
    for (let seed = 1; seed <= 20; seed++) {
      expect(aggregate(shuffle(runs(), seed)).testBreakdown.waterfalls, String(seed)).toEqual(
        expected,
      );
    }
    expect(expected.map((w) => w.test.title)).toEqual([
      'test 5',
      'test 4',
      'test 3',
      'test 2',
      'test 1',
    ]);
    // The slower run of each test (repeatEachIndex 1) is shown, once.
    expect(expected.map((w) => w.test.repeatEachIndex)).toEqual([1, 1, 1, 1, 1]);
    expect(expected[0]?.totalMs).toBe(607);
  });

  test('08-AC-21 equal totals: smaller repeatEachIndex, then retry, then file and line', () => {
    const results: Result[] = [];
    for (const [r, retry] of [
      [1, 0],
      [0, 1],
      [0, 0],
    ] as const) {
      const t = meta({ repeatEachIndex: r, retry });
      results.push({ meta: t, requests: [{ key: 'GET /a', sample: req(t, 0) }] });
    }
    for (const seed of [1, 2, 3, 4]) {
      const [w] = aggregate(shuffle(results, seed)).testBreakdown.waterfalls;
      expect(w?.test.repeatEachIndex).toBe(0);
    }
    const retry = aggregate(results.slice(0, 2)).testBreakdown.waterfalls[0];
    expect(retry?.test.repeatEachIndex).toBe(0);
  });

  test('08-AC-21 offsets from TestResult.startTime; 250 requests give 200, omitted 50 and spanMs of all', () => {
    const t = meta({ startTime: START });
    const requests = Array.from({ length: 250 }, (_, i) => ({
      key: i % 2 === 0 ? 'GET /a' : 'GET /b',
      // Reverse start order; one request starts before the test (clock rounding).
      sample: req(t, i, {
        startTime: i === 0 ? START - 3 : START + 2 * (250 - i),
        duration: 10,
      }),
    }));
    const [w] = aggregate([{ meta: t, requests }]).testBreakdown.waterfalls;
    if (w === undefined) throw new Error('no waterfall');
    expect(w.requestCount).toBe(250);
    expect(w.requests).toHaveLength(200);
    expect(w.omitted).toBe(50);
    expect(w.requests[0]).toEqual({ offset: 0, duration: 10, key: 'GET /a', status: '200' });
    expect(w.requests[1]?.offset).toBe(2);
    // Sorted by offset, then ordinal.
    const offsets = w.requests.map((r) => r.offset);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    // The latest start is the request of ordinal 1 at +498 ms: span 508 ms.
    expect(w.spanMs).toBe(508);
    expect(w.totalMs).toBe(2500);
    expect(w.test).toEqual({
      title: t.title,
      project: t.project,
      file: t.file,
      line: t.line,
      repeatEachIndex: 0,
    });
  });

  test('a request without a time is kept with duration null; runs without timed requests have no waterfall', () => {
    const t = meta();
    const failed = req(t, 1, {
      status: 'FAILED',
      failureText: 'net::ERR_FAILED',
      duration: null,
      ttfb: null,
    });
    const [w] = aggregate([
      {
        meta: t,
        requests: [
          { key: 'GET /a', sample: req(t, 0) },
          { key: 'GET /a', sample: failed },
        ],
      },
    ]).testBreakdown.waterfalls;
    expect(w?.requests[1]).toEqual({ offset: 10, duration: null, key: 'GET /a', status: 'FAILED' });
    const none = meta({ title: 'only failures' });
    expect(
      aggregate([
        { meta: none, requests: [{ key: 'GET /a', sample: req(none, 0, { status: 500 }) }] },
      ]).testBreakdown.waterfalls,
    ).toEqual([]);
  });
});
