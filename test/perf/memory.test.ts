// 12-PERF-02: memory of the aggregator (NF-02, 08-AC-08). 500 keys get 50,000 successful samples
// each; the retained samples per key stay at the limit (advanced.maxSamplesPerKey) and the memory
// growth stays within the budget of 32 bytes per retained sample (08-REQ-29) with 20% tolerance.
// Run with --expose-gc (vitest.perf.config.ts).
import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../../src/core/config/index.ts';
import { Aggregator, resultId, testIdentity } from '../../src/core/stats/index.ts';
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
        failed: false,
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
    const ordinals = new Map<string, number>();
    for (let i = 0; i < SAMPLES_PER_KEY; i++) {
      const test = tests[i % EXECUTIONS] as TestMeta;
      for (let k = 0; k < KEYS; k++) {
        const counter = `${test.resultId}`;
        const ordinal = ordinals.get(counter) ?? 0;
        ordinals.set(counter, ordinal + 1);
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
          ordinal,
          test,
        };
        aggregator.addRequest(keys[k] as string, sample, 'https://app.example', '', 'chromium');
      }
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
});
