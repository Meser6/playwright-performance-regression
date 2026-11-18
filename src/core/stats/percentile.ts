// Percentiles by linear interpolation, "type 7" of Hyndman and Fan (08-REQ-09, 08-D-01).

/**
 * Percentile `p` (0–100) of an ascending sorted array; null for an empty array (08-REQ-09).
 * The fractional position is computed from integers where possible, so control values such as
 * p95 of [100, 200, 300, 400, 500] = 480 come out exact. Not rounded: the caller rounds.
 */
export function percentile(sorted: readonly number[], p: number): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  // h = (n − 1) · p / 100, split into lo and the fraction (h − lo) without subtracting floats.
  const scaled = (n - 1) * p;
  const lo = Math.min(Math.floor(scaled / 100), n - 1);
  const x = sorted[lo] ?? Number.NaN;
  if (lo + 1 >= n) return x;
  const next = sorted[lo + 1] ?? Number.NaN;
  return x + ((scaled - lo * 100) / 100) * (next - x);
}

/** Percentile names that are always reported (08-REQ-10). */
const ALWAYS = ['p50', 'p90', 'p95', 'p99'] as const;

/** Value of a percentile name such as "p95" or "p97.5" (03, checks.time.percentile.level). */
function parsePercentileName(name: string): number {
  if (!/^p\d+(?:\.\d)?$/u.test(name)) {
    throw new Error(`Invalid percentile name "${name}"; expected a name like "p95".`);
  }
  const value = Number(name.slice(1));
  if (value > 100) throw new Error(`Invalid percentile name "${name}"; at most "p100".`);
  return value;
}

/**
 * Names and values of the reported percentiles: p50, p90, p95, p99 and the evaluated level when
 * it is another one, ordered by value (08-REQ-10).
 */
export function percentileNames(evaluated: string): [string, number][] {
  const names = new Set<string>([...ALWAYS, evaluated]);
  return [...names]
    .map((name): [string, number] => [name, parsePercentileName(name)])
    .sort((a, b) => a[1] - b[1]);
}
