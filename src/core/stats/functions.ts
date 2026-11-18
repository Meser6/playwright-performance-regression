// Statistical functions of the core on ascending sorted durations (08, chapter 8). Only
// operations with results fixed by IEEE 754 are used (08-REQ-27).
import { roundRatio } from '../format/index.ts';

/** Confidence level 95% of the Wilson interval (08-REQ-23, P-13). */
export const WILSON_Z = 1.96;

/** Number of values ≤ t in an ascending sorted array (binary search). */
function countAtMost(sorted: readonly number[], t: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] ?? Number.NaN) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Apdex counts without rounding (08-REQ-21): s = samples ≤ t, u = samples in (t, 4t], n = all.
 * The apdex rule takes k = s + u / 2 for the Wilson bound from these (09-REQ-09).
 */
export function apdexCounts(
  sorted: readonly number[],
  t: number,
): { s: number; u: number; n: number } {
  const s = countAtMost(sorted, t);
  const u = countAtMost(sorted, 4 * t) - s;
  return { s, u, n: sorted.length };
}

/** Apdex(t) = (S + U / 2) / n, rounded to 4 decimal places; null for no samples (08-REQ-21). */
export function apdex(sorted: readonly number[], t: number): number | null {
  const { s, u, n } = apdexCounts(sorted, t);
  return n === 0 ? null : roundRatio((s + u / 2) / n);
}

/** Exceeding share k / n: k = samples strictly above t, n = all (08-REQ-22). */
export function exceedingShare(sorted: readonly number[], t: number): { k: number; n: number } {
  return { k: sorted.length - countAtMost(sorted, t), n: sorted.length };
}

/**
 * Wilson score interval of the share k / n at 95% (08-REQ-23), each bound rounded to 4 decimal
 * places and kept within [0, 1]. `k` may be fractional (k = S + U / 2 of Apdex). Null for n = 0.
 */
export function wilsonBounds(k: number, n: number): { lower: number; upper: number } | null {
  if (n === 0) return null;
  const z2 = WILSON_Z * WILSON_Z;
  const share = k / n;
  const center = share + z2 / (2 * n);
  const margin = WILSON_Z * Math.sqrt((share * (1 - share)) / n + z2 / (4 * n * n));
  const denominator = 1 + z2 / n;
  const clamp = (x: number): number => Math.min(1, Math.max(0, roundRatio(x)));
  return {
    lower: clamp((center - margin) / denominator),
    upper: clamp((center + margin) / denominator),
  };
}
