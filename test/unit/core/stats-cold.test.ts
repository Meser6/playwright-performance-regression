// Cold samples (08, chapter 7.3) and non-success samples (08, chapter 7.4) of the aggregator.
import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../../../src/core/config/index.ts';
import { Aggregator, resultId, testIdentity } from '../../../src/core/stats/index.ts';
import type {
  AggregatorOptions,
  EnrichedRequestSample,
  EnrichedStepSample,
  TestMeta,
} from '../../../src/core/stats/index.ts';

const resolved = resolveConfig({}, {});
if (!resolved.ok) throw new Error('config');
const CFG = resolved.value.config;
const KEY = 'GET /api/tickets';
const START = Date.UTC(2026, 10, 26, 10, 0, 0, 0);

function options(overrides: Partial<AggregatorOptions> = {}): AggregatorOptions {
  return {
    advanced: CFG.advanced,
    successStatuses: CFG.measure.successStatuses,
    errors: { statuses: CFG.checks.errors.statuses },
    measuredProjects: new Set(['chromium']),
    evaluatedPercentile: 'p95',
    rawUrls: false,
    coldSamples: 1,
    minSamples: 5,
    ...overrides,
  };
}

function meta(index: number): TestMeta {
  const file = 'tests/a.spec.ts';
  const title = 'opens tickets';
  return {
    identity: testIdentity('chromium', file, title),
    resultId: resultId(`${file}:${title}`, index, 0),
    title,
    project: 'chromium',
    file,
    line: 3 + index,
    repeatEachIndex: index,
    retry: 0,
    failed: false,
    startTime: START + index * 1000,
  };
}

function sample(test: TestMeta, ordinal: number, status: number, duration: number) {
  const s: EnrichedRequestSample = {
    method: 'GET',
    url: 'https://app.example/api/tickets',
    resourceType: 'fetch',
    status,
    startTime: test.startTime + ordinal,
    duration,
    requestStart: 1,
    ttfb: null,
    timeSource: 'browser',
    fromServiceWorker: false,
    ordinal,
    test,
  };
  return s;
}

/** One result per sample, in this order; [status, duration]. */
function aggregate(samples: [number, number][], overrides: Partial<AggregatorOptions> = {}) {
  const agg = new Aggregator(options(overrides));
  samples.forEach(([status, duration], i) => {
    const test = meta(i);
    agg.addRequest(KEY, sample(test, 0, status, duration), 'https://app.example', '', 'chromium');
    agg.endResult(test);
  });
  return agg.finalize();
}

const TEN: [number, number][] = [
  [200, 900],
  ...Array.from({ length: 9 }, (_, i): [number, number] => [200, 98 + (i % 5)]),
];

describe('cold samples (08-REQ-41 – 08-REQ-44)', () => {
  test('08-AC-24 a key with 10 samples sets the slow first one apart; coldSamples 0 keeps 1.0.x statistics', () => {
    const { endpoints, issues } = aggregate(TEN);
    const a = endpoints[KEY];
    expect(a?.successCount).toBe(9);
    expect(a?.count).toBe(10);
    expect(a?.cold).toMatchObject({ count: 1, excluded: true, reason: null, durations: [900] });
    expect(a?.cold?.max).toBe(900);
    expect(a?.cold?.ratio).toBeCloseTo(9, 0);
    // p95 of the 9 warm samples only.
    expect(a?.stats?.max).toBe(102);
    expect(a?.stats?.percentiles['p95']).toBeLessThan(103);
    expect(a?.samples.durations).not.toContain(900);
    expect(a?.slowest.map((s) => s.duration)).not.toContain(900);
    expect(a?.cold?.warmP50).toBe(a?.stats?.percentiles['p50']);
    expect(a?.cold?.test).toMatchObject({ file: 'tests/a.spec.ts', line: 3 });
    expect(issues.map((i) => i.code)).toContain('STATS_COLD_SLOW');

    const off = aggregate(TEN, { coldSamples: 0 }).endpoints[KEY];
    expect(off?.cold).toBeNull();
    expect(off?.successCount).toBe(10);
    expect(off?.stats?.max).toBe(900);
  });

  test('08-AC-25 a key with 5 samples keeps its cold sample in the statistics (too-few-samples)', () => {
    const five = TEN.slice(0, 5);
    const a = aggregate(five).endpoints[KEY];
    const old = aggregate(five, { coldSamples: 0 }).endpoints[KEY];
    expect(a?.cold).toMatchObject({ count: 1, excluded: false, reason: 'too-few-samples' });
    expect(a?.successCount).toBe(5);
    expect(a?.stats).toEqual(old?.stats);
    expect(a?.samples).toEqual(old?.samples);
    expect(a?.slowest).toEqual(old?.slowest);
    // 6 = coldSamples + minSamples timed samples is the first count that excludes.
    expect(aggregate(TEN.slice(0, 6)).endpoints[KEY]?.cold?.excluded).toBe(true);
  });

  test('cold samples are the first timed ones in input order; errors before them do not count', () => {
    const { endpoints } = aggregate([
      [504, 3000],
      [200, 700],
      ...Array.from({ length: 6 }, (_, i): [number, number] => [200, 100 + i]),
    ]);
    const a = endpoints[KEY];
    expect(a?.cold?.durations).toEqual([700]);
    // The 504 after start-up is an error (08-REQ-42) and a non-success sample.
    expect(a?.errorCount).toBe(1);
    expect(a?.nonSuccessCount).toBe(1);
    const two = aggregate(TEN, { coldSamples: 2 }).endpoints[KEY];
    expect(two?.cold).toMatchObject({ count: 2, durations: [900, 98] });
    expect(two?.successCount).toBe(8);
  });

  test('STATS_COLD_SLOW needs ratio ≥ 3 and at least 100 ms more than the warm p50', () => {
    const fast = aggregate([
      [200, 7],
      ...Array.from({ length: 9 }, (_, i): [number, number] => [200, 2 + (i % 2)]),
    ]);
    expect(fast.endpoints[KEY]?.cold?.ratio).toBeGreaterThanOrEqual(3);
    expect(fast.issues.map((i) => i.code)).not.toContain('STATS_COLD_SLOW');
    const { issues } = aggregate(TEN);
    const warning = issues.find((i) => i.code === 'STATS_COLD_SLOW');
    expect(warning?.message).toBe(
      `1 key is much slower on the first call (cold start): ${KEY} 900 ms vs warm p50 100 ms (×9.0).`,
    );
  });

  test('08-AC-28 cold samples are counted in each pass: 2 calls per pass exclude, 1 call per pass keeps', () => {
    const agg = new Aggregator(options());
    const other = 'GET /api/users';
    for (let pass = 0; pass < 5; pass++) {
      // A new pass, as the reporter starts one before each later pass (08-REQ-41).
      if (pass > 0) agg.startSegment();
      const test = meta(pass);
      agg.addRequest(KEY, sample(test, 0, 200, 900), 'https://app.example', '', 'chromium');
      agg.addRequest(KEY, sample(test, 1, 200, 100 + pass), 'https://app.example', '', 'chromium');
      agg.addRequest(
        other,
        sample(test, 2, 200, 300 + pass),
        'https://app.example',
        '',
        'chromium',
      );
      agg.endResult(test);
    }
    const { endpoints } = agg.finalize();
    const twice = endpoints[KEY];
    expect(twice?.cold).toMatchObject({ count: 5, excluded: true, reason: null, max: 900 });
    expect(twice?.cold?.durations).toEqual([900, 900, 900, 900, 900]);
    expect(twice?.successCount).toBe(5);
    expect(twice?.stats?.percentiles['p50']).toBeCloseTo(102, 0);
    expect(twice?.count).toBe(10);
    const once = endpoints[other];
    expect(once?.cold).toMatchObject({ count: 5, excluded: false, reason: 'too-few-samples' });
    // Only cold samples: warmP50 is the p50 of all of them (08-REQ-43).
    expect(once?.cold?.warmP50).toBe(once?.stats?.percentiles['p50']);
    expect(once?.successCount).toBe(5);
    // Without the segments (one pass of 10 calls) only the very first call is cold.
    expect(aggregate(TEN).endpoints[KEY]?.cold?.count).toBe(1);
  });

  test('more than 5 cold samples keep the first 5 durations and the largest of all as max', () => {
    const agg = new Aggregator(options());
    for (let pass = 0; pass < 8; pass++) {
      if (pass > 0) agg.startSegment();
      const test = meta(pass);
      agg.addRequest(
        KEY,
        sample(test, 0, 200, 800 + pass * 10),
        'https://app.example',
        '',
        'chromium',
      );
      for (let i = 1; i <= 2; i++) {
        agg.addRequest(KEY, sample(test, i, 200, 100 + i), 'https://app.example', '', 'chromium');
      }
      agg.endResult(test);
    }
    const cold = agg.finalize().endpoints[KEY]?.cold;
    expect(cold?.count).toBe(8);
    expect(cold?.durations).toEqual([800, 810, 820, 830, 840]);
    expect(cold?.max).toBe(870);
    expect(cold?.excluded).toBe(true);
  });

  test('step keys have cold samples too, and nonSuccessCount null and failedTimings []', () => {
    const agg = new Aggregator(options());
    for (let i = 0; i < 7; i++) {
      const test = meta(i);
      const step: EnrichedStepSample = {
        key: 'open page',
        outcome: 'ok',
        duration: i === 0 ? 5000 : 1000 + i,
        endTime: START + i * 1000 + 6000,
        location: { file: 'tests/a.spec.ts', line: 4 },
        ordinal: 0,
        test,
      } as EnrichedStepSample;
      agg.addStep(step);
      agg.endResult(test);
    }
    const s = agg.finalize().steps['open page'];
    expect(s?.cold).toMatchObject({ excluded: true, max: 5000 });
    expect(s?.nonSuccessCount).toBeNull();
    expect(s?.failedTimings).toEqual([]);
  });
});

describe('non-success samples (08-REQ-46, 08-REQ-47)', () => {
  test('08-AC-27 10 × 200 and 10 × 401 give nonSuccessCount 10, failedTimings for 401 and stats of the 200s', () => {
    const samples: [number, number][] = [];
    for (let i = 0; i < 10; i++) samples.push([200, 118 + (i % 5)], [401, 7 + (i % 3)]);
    const a = aggregate(samples, { coldSamples: 0 }).endpoints[KEY];
    expect(a?.nonSuccessCount).toBe(10);
    expect(a?.failedTimings).toEqual([{ status: 401, count: 10, p50: 8, p95: 9 }]);
    expect(a?.successCount).toBe(10);
    expect(a?.stats?.min).toBe(118);
    // 401 is no error by default (08-REQ-30).
    expect(a?.errorCount).toBe(0);
  });

  test('FAILED, ABORTED and PENDING are no non-success samples; at most 5 statuses, most samples first', () => {
    const agg = new Aggregator(options({ coldSamples: 0 }));
    const statuses = [404, 404, 404, 500, 500, 401, 403, 409, 422, 422];
    statuses.forEach((status, i) => {
      const test = meta(i);
      agg.addRequest(KEY, sample(test, 0, status, 10 + i), 'https://app.example', '', 'chromium');
      agg.endResult(test);
    });
    const failed = { ...sample(meta(20), 0, 200, 1), status: 'FAILED' as const, duration: null };
    agg.addRequest(KEY, failed, 'https://app.example', '', 'chromium');
    const a = agg.finalize().endpoints[KEY];
    expect(a?.nonSuccessCount).toBe(10);
    expect(a?.failedTimings.map((f) => [f.status, f.count])).toEqual([
      [404, 3],
      [422, 2],
      [500, 2],
      [401, 1],
      [403, 1],
    ]);
  });
});
