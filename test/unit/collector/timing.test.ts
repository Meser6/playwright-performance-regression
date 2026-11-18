import { describe, expect, test } from 'vitest';
import { PENDING_RESERVE_MS } from '../../../src/collector/constants.ts';
import { computeTiming, pendingBudgetMs, roundMs } from '../../../src/collector/timing.ts';

const fallback = { startedAtNode: 1000, finishedAtNode: 1234.56 };

describe('computeTiming', () => {
  test('05-AC-05 null for unavailable values, node fallback and rounding to 0.1 ms', () => {
    expect(
      computeTiming(
        {
          startTime: 1763460000123.6,
          requestStart: 0.44,
          responseStart: 101.26,
          responseEnd: 203.04,
        },
        fallback,
      ),
    ).toEqual({
      startTime: 1763460000124,
      duration: 203,
      requestStart: 0.4,
      ttfb: 100.8,
      timeSource: 'browser',
    });
    expect(
      computeTiming(
        { startTime: 1763460000000, requestStart: -1, responseStart: -1, responseEnd: 50.05 },
        fallback,
      ),
    ).toEqual({
      startTime: 1763460000000,
      duration: 50.1,
      requestStart: null,
      ttfb: null,
      timeSource: 'browser',
    });
    expect(
      computeTiming(
        { startTime: 1763460000000, requestStart: 2, responseStart: -1, responseEnd: -1 },
        fallback,
      ),
    ).toEqual({
      startTime: 1763460000000,
      duration: 234.6,
      requestStart: 2,
      ttfb: null,
      timeSource: 'node',
    });
  });

  test('a negative time to first byte is null', () => {
    const timing = computeTiming(
      { startTime: 1, requestStart: 10, responseStart: 5, responseEnd: 20 },
      fallback,
    );
    expect(timing.ttfb).toBeNull();
  });

  test('roundMs never gives -0', () => {
    expect(Object.is(roundMs(-0.01), 0)).toBe(true);
    expect(roundMs(0.05)).toBe(0.1);
  });
});

describe('pendingBudgetMs', () => {
  test('05-AC-13 table of cases', () => {
    expect(PENDING_RESERVE_MS).toBe(1000);
    const cases: [number, number, number, number][] = [
      // pendingTimeoutMs, testTimeoutMs, sinceTeardownStartMs, expected
      [2000, 30_000, 0, 2000],
      [2000, 30_000, 28_000, 1000],
      [2000, 2000, 0, 1000],
      [2000, 2000, 300, 700],
      [2000, 2000, 1500, 0],
      [2000, 1000, 0, 0],
      [0, 30_000, 0, 0],
      [2000, 0, 0, 2000],
      [2000, 0, 99_999, 2000],
      [7000, 0, 0, 7000],
    ];
    for (const [pendingTimeoutMs, testTimeoutMs, sinceTeardownStartMs, expected] of cases) {
      expect(
        pendingBudgetMs({ pendingTimeoutMs, testTimeoutMs, sinceTeardownStartMs }),
        `${pendingTimeoutMs}/${testTimeoutMs}/${sinceTeardownStartMs}`,
      ).toBe(expected);
    }
  });
});
