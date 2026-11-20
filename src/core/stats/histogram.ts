// Histogram of the retained durations on a fixed logarithmic scale (08-REQ-34, 08-D-16). Only
// integer arithmetic and one division per edge: no Math.log or Math.pow (08-REQ-27).

/**
 * Mantissas of the scale, 48 per decade: M[k] = round(1000 · 10^(k/48)) (08-REQ-34, P-13). A
 * documented constant, so that the edges do not depend on the engine's Math.pow.
 */
export const HISTOGRAM_MANTISSAS: readonly number[] = Object.freeze([
  1000, 1049, 1101, 1155, 1212, 1271, 1334, 1399, 1468, 1540, 1616, 1695, 1778, 1866, 1957, 2054,
  2154, 2260, 2371, 2488, 2610, 2738, 2873, 3014, 3162, 3318, 3481, 3652, 3831, 4019, 4217, 4424,
  4642, 4870, 5109, 5360, 5623, 5900, 6190, 6494, 6813, 7148, 7499, 7867, 8254, 8660, 9085, 9532,
]);

/** Edges per decade of the scale. */
export const HISTOGRAM_STEPS_PER_DECADE = 48;
/** Most bins of one histogram. */
export const HISTOGRAM_MAX_BINS = 30;

export interface Histogram {
  edges: number[];
  counts: number[];
}

/** M[j mod 48] · 10^floor(j / 48): edge j in thousandths of a millisecond, an exact integer. */
function edgeMicros(j: number): number {
  let scale = 1;
  for (let d = Math.floor(j / HISTOGRAM_STEPS_PER_DECADE); d > 0; d--) scale *= 10;
  return (HISTOGRAM_MANTISSAS[j % HISTOGRAM_STEPS_PER_DECADE] ?? 0) * scale;
}

/** Edge j in ms: E(j) = M[j mod 48] · 10^d / 1000, the result of one division. */
export function histogramEdge(j: number): number {
  return edgeMicros(j) / 1000;
}

/** Duration in ms (0.1 ms resolution, 02-REQ-07) as thousandths of a ms: exact for comparisons. */
function micros(ms: number): number {
  return Math.round(ms * 10) * 100;
}

/**
 * Histogram of ascending sorted durations (08-REQ-34): bins on the fixed log scale between the
 * minimum and the maximum, merged by a whole step f to at most 30 bins. Bin i is
 * [edges[i], edges[i + 1]); when the minimum is below 1 ms the first edge is 0. Null for an empty
 * array.
 */
export function histogram(sorted: readonly number[]): Histogram | null {
  const n = sorted.length;
  if (n === 0) return null;
  const a = micros(sorted[0] ?? 0);
  const b = micros(sorted[n - 1] ?? 0);
  const belowOne = a < edgeMicros(0);
  // jLo: the largest j with E(j) ≤ a (0 below 1 ms); jHi: the smallest j with E(j) > b.
  let jLo = 0;
  if (!belowOne) while (edgeMicros(jLo + 1) <= a) jLo++;
  let jHi = jLo + 1;
  while (edgeMicros(jHi) <= b) jHi++;
  const k = jHi - jLo;
  const f = Math.ceil(k / HISTOGRAM_MAX_BINS);
  const bins = Math.ceil(k / f);
  const bounds: number[] = [];
  for (let i = 0; i <= bins; i++) bounds.push(edgeMicros(jLo + i * f));
  if (belowOne) bounds[0] = 0;
  const counts = new Array<number>(bins).fill(0);
  let bin = 0;
  for (const value of sorted) {
    const x = micros(value);
    while (bin < bins - 1 && (bounds[bin + 1] ?? 0) <= x) bin++;
    counts[bin] = (counts[bin] ?? 0) + 1;
  }
  return { edges: bounds.map((e) => e / 1000), counts };
}
