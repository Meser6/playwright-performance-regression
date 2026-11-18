// Percentiles and the statistical functions of the core (08, chapters 5 and 8).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { roundMs } from '../../../src/core/format/index.ts';
import {
  WILSON_Z,
  apdex,
  apdexCounts,
  exceedingShare,
  percentile,
  percentileNames,
  wilsonBounds,
} from '../../../src/core/stats/index.ts';

interface PercentileCase {
  name: string;
  durations: number[];
  expected: Record<string, number>;
}

const GOLDEN = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../golden/stats/percentiles.json'), 'utf8'),
) as { cases: PercentileCase[] };

describe('percentile (08-REQ-09, 08-REQ-10)', () => {
  test('08-AC-01 control values of type 7 interpolation', () => {
    const xs = [100, 200, 300, 400, 500];
    expect(percentile(xs, 50)).toBe(300);
    expect(percentile(xs, 90)).toBe(460);
    expect(percentile(xs, 95)).toBe(480);
    expect(percentile(xs, 99)).toBe(496);
  });

  test.each(GOLDEN.cases.map((c) => [c.name, c] as const))(
    '08-AC-01 matches numpy.percentile on golden set %s',
    (_name, c) => {
      for (const [name, expected] of Object.entries(c.expected)) {
        const actual = percentile(c.durations, Number(name.slice(1)));
        expect(actual, name).not.toBeNull();
        expect(Math.abs((actual ?? Number.NaN) - expected), name).toBeLessThan(1e-9);
        expect(roundMs(actual ?? Number.NaN), name).toBe(roundMs(expected));
      }
    },
  );

  test('empty input gives null, a single value gives that value for every p', () => {
    expect(percentile([], 50)).toBeNull();
    for (const p of [0, 50, 95, 99.9, 100]) expect(percentile([42.5], p)).toBe(42.5);
  });

  test('all equal values give that value', () => {
    for (const p of [0, 50, 97.5, 100]) expect(percentile([7, 7, 7, 7], p)).toBe(7);
  });

  test('percentileNames always has p50, p90, p95, p99 plus the evaluated level', () => {
    expect(percentileNames('p95')).toEqual([
      ['p50', 50],
      ['p90', 90],
      ['p95', 95],
      ['p99', 99],
    ]);
    expect(percentileNames('p97.5')).toEqual([
      ['p50', 50],
      ['p90', 90],
      ['p95', 95],
      ['p97.5', 97.5],
      ['p99', 99],
    ]);
    expect(() => percentileNames('median')).toThrow(/percentile/);
  });
});

describe('Apdex (08-REQ-21)', () => {
  const xs = [100, 200, 300, 400, 500, 600, 900, 2100, 2500, 3000];

  test('08-AC-02 Apdex control value: S = 5, U = 2, Apdex = 0.6', () => {
    expect(apdexCounts(xs, 500)).toEqual({ s: 5, u: 2, n: 10 });
    expect(apdex(xs, 500)).toBe(0.6);
  });

  test('samples equal to T are satisfied, equal to 4T are tolerating', () => {
    expect(apdexCounts([10, 40, 40.1], 10)).toEqual({ s: 1, u: 1, n: 3 });
  });

  test('no samples: null Apdex and zero counts', () => {
    expect(apdex([], 500)).toBeNull();
    expect(apdexCounts([], 500)).toEqual({ s: 0, u: 0, n: 0 });
  });

  test('Apdex is rounded to 4 decimal places (08-REQ-24)', () => {
    // (1 + 1 / 2) / 3 = 0.5
    expect(apdex([1, 2, 10], 1.5)).toBe(0.5);
    // 2 / 3 = 0.666… → 0.6667
    expect(apdex([1, 1, 100], 1)).toBe(0.6667);
  });

  test('08-AC-16 the apdex rule bound uses k = S + U / 2 = 16.5, not rounded Apdex × n', () => {
    const sorted = [
      ...Array.from({ length: 15 }, () => 100),
      ...Array.from({ length: 3 }, () => 1000),
      ...Array.from({ length: 2 }, () => 5000),
    ];
    const { s, u, n } = apdexCounts(sorted, 500);
    expect({ s, u, n }).toEqual({ s: 15, u: 3, n: 20 });
    const k = s + u / 2;
    expect(k).toBe(16.5);
    // Reference values computed independently with the formula of 08-REQ-23.
    expect(wilsonBounds(k, n)).toEqual({ lower: 0.6114, upper: 0.9339 });
    expect(wilsonBounds(16, n)).not.toEqual(wilsonBounds(k, n));
  });
});

describe('exceeding share (08-REQ-22)', () => {
  test('k counts samples strictly above T', () => {
    expect(exceedingShare([100, 200, 300, 300, 400], 300)).toEqual({ k: 1, n: 5 });
    expect(exceedingShare([100, 200], 50)).toEqual({ k: 2, n: 2 });
    expect(exceedingShare([], 50)).toEqual({ k: 0, n: 0 });
  });
});

describe('Wilson bounds (08-REQ-23)', () => {
  test('z is the documented constant 1.96', () => {
    expect(WILSON_Z).toBe(1.96);
  });

  test.each([
    [0, 20, 0.1611],
    [1, 20, 0.2361],
    [0, 100, 0.037],
    [5, 100, 0.1118],
  ])('08-AC-02 upper bound control value k = %d, n = %d → %d', (k, n, upper) => {
    expect(wilsonBounds(k, n)?.upper).toBe(upper);
  });

  test.each([
    [0, 20, 0],
    [1, 20, 0.0089],
    [5, 100, 0.0215],
    [3, 10, 0.1078],
    [20, 20, 0.8389],
  ])('08-AC-02 lower bound k = %d, n = %d → %d', (k, n, lower) => {
    expect(wilsonBounds(k, n)?.lower).toBe(lower);
  });

  test('n = 0 gives null', () => {
    expect(wilsonBounds(0, 0)).toBeNull();
  });

  test('bounds stay within [0, 1] and are never -0', () => {
    const zero = wilsonBounds(0, 20);
    expect(Object.is(zero?.lower, 0)).toBe(true);
    expect(wilsonBounds(20, 20)?.upper).toBe(1);
  });
});
