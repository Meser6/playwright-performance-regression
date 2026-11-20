// 12-PERF-02: memory of the aggregator (NF-02, 08-AC-08). 500 keys get 50,000 successful samples
// each; the retained samples per key stay at the limit (advanced.maxSamplesPerKey) and the memory
// growth stays within the budget of 32 bytes per retained sample (08-REQ-29) with 20% tolerance.
// The per-test data of the HTML report (08, chapter 7.1) for 2000 tests x 30 keys x 10 runs stays
// within the estimate of 08-REQ-39 with 50% tolerance (08-AC-22).
// Run with --expose-gc (vitest.perf.config.ts).
import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../../src/core/config/index.ts';
import {
  Aggregator,
  TestBreakdownBuilder,
  resultId,
  testIdentity,
} from '../../src/core/stats/index.ts';
import type { EnrichedRequestSample, TestMeta } from '../../src/core/stats/index.ts';
import { recordResult } from './helpers.ts';

const KEYS = 500;
const SAMPLES_PER_KEY = 50_000;
const BYTES_PER_SAMPLE = 32;
const TOLERANCE = 1.2;
/** Test executions the samples come from (identity and result id per execution). */
const EXECUTIONS = 100;

function gc(): void {
  const collect = (globalThis as { gc?: () => void }).gc;
  if (collect === undefined) throw new Error('Run with --expose-gc (pnpm test:perf).');
  collect();
  collect();
}

function used(): number {
  const memory = process.memoryUsage();
  return memory.heapUsed + memory.arrayBuffers;
}

describe('12-PERF-02 aggregator memory', () => {
  test('08-AC-08 500 keys x 50,000 samples: retained samples at the limit, memory within the budget', () => {
    const resolved = resolveConfig({}, {});
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.issues));
    const config = resolved.value.config;
    const limit = config.advanced.maxSamplesPerKey;
    const tests: TestMeta[] = Array.from({ length: EXECUTIONS }, (_, i) => {
      const title = `suite › test ${i % 10}`;
      const file = `tests/t${i % 10}.spec.ts`;
      return {
        identity: testIdentity('chromium', file, title),
        resultId: resultId(`${file}:${title}`, Math.floor(i / 10), 0),
        title,
        project: 'chromium',
        file,
        line: 10,
        repeatEachIndex: Math.floor(i / 10),
        retry: 0,
        failed: false,
        startTime: 1_763_460_000_000,
      };
    });
    const keys = Array.from({ length: KEYS }, (_, k) => `GET /api/resource-${k}/:id`);

    gc();
    const before = used();
    const started = performance.now();
    const aggregator = new Aggregator({
      advanced: config.advanced,
      successStatuses: config.measure.successStatuses,
      errors: { statuses: config.checks.errors.statuses },
      measuredProjects: new Set(['chromium']),
      evaluatedPercentile: config.checks.time.percentile.level,
      rawUrls: false,
    });
    // The reporter adds all samples of one test result, then closes it (08-REQ-36).
    for (let e = 0; e < EXECUTIONS; e++) {
      const test = tests[e] as TestMeta;
      let ordinal = 0;
      for (let i = e; i < SAMPLES_PER_KEY; i += EXECUTIONS) {
        for (let k = 0; k < KEYS; k++) {
          const sample: EnrichedRequestSample = {
            method: 'GET',
            url: `https://app.example/api/resource-${k}/${i}`,
            resourceType: 'fetch',
            status: 200,
            startTime: 1_763_460_000_000 + i,
            duration: 50 + ((i * 7919 + k * 104_729) % 4000) / 10,
            requestStart: 1,
            ttfb: 20,
            timeSource: 'browser',
            fromServiceWorker: false,
            ordinal: ordinal++,
            test,
          };
          aggregator.addRequest(keys[k] as string, sample, 'https://app.example', '', 'chromium');
        }
      }
      aggregator.endResult(test);
    }
    const addMs = performance.now() - started;
    gc();
    const growth = used() - before;
    const budget = KEYS * limit * BYTES_PER_SAMPLE * TOLERANCE;

    const aggregates = aggregator.finalize();
    const counts = Object.values(aggregates.endpoints).map((a) => a.samples.durations.length);
    recordResult('12-PERF-02', {
      keys: KEYS,
      samplesPerKey: SAMPLES_PER_KEY,
      retainedPerKey: limit,
      memoryGrowthBytes: growth,
      budgetBytes: budget,
      bytesPerRetainedSample: Math.round((growth / (KEYS * limit)) * 10) / 10,
      addMs: Math.round(addMs),
    });
    expect(counts).toHaveLength(KEYS);
    expect(new Set(counts)).toEqual(new Set([limit]));
    expect(Object.values(aggregates.endpoints).every((a) => a.samples.sampled)).toBe(true);
    expect(growth).toBeLessThan(budget);
  }, 600_000);

  test('08-AC-22 per-test data of 2000 tests x 30 keys x 10 runs stays within the estimate', () => {
    const TESTS = 2000;
    const KEYS_PER_TEST = 30;
    const RUNS = 10;
    /** 08-REQ-39: about 50 bytes per (test, key), 50% tolerance. */
    const budget = TESTS * KEYS_PER_TEST * 50 * 1.5;
    const keys = Array.from({ length: 300 }, (_, k) => `GET /api/resource-${k}/:id`);
    const metas = Array.from({ length: TESTS }, (_, t): TestMeta => {
      const title = `suite › test ${t}`;
      const file = `tests/t${t % 50}.spec.ts`;
      return {
        identity: testIdentity('chromium', file, title),
        resultId: '',
        title,
        project: 'chromium',
        file,
        line: 10 + t,
        repeatEachIndex: 0,
        retry: 0,
        failed: false,
        startTime: 1_763_460_000_000,
      };
    });
    gc();
    const before = used();
    const builder = new TestBreakdownBuilder();
    for (let run = 0; run < RUNS; run++) {
      metas.forEach((base, t) => {
        const meta = { ...base, repeatEachIndex: run, resultId: `${t}\u0000${run}\u00000` };
        for (let k = 0; k < KEYS_PER_TEST; k++) {
          const key = keys[(t * 7 + k) % keys.length] as string;
          builder.addRequest(meta, key, '200', false, 500 + ((t + k + run) % 997), 0, k);
        }
        builder.endResult(meta);
      });
    }
    gc();
    const growth = used() - before;
    const breakdown = builder.build();
    recordResult('12-PERF-02 test breakdown', {
      tests: TESTS,
      keysPerTest: KEYS_PER_TEST,
      runs: RUNS,
      memoryGrowthBytes: growth,
      budgetBytes: budget,
      bytesPerTestKey: Math.round((growth / (TESTS * KEYS_PER_TEST)) * 10) / 10,
    });
    expect(breakdown.tests).toHaveLength(500);
    expect(breakdown.waterfalls).toHaveLength(5);
    expect(growth).toBeLessThan(budget);
  }, 600_000);
});
