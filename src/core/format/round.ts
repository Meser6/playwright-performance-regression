// Rounding rules of the file formats (02-REQ-07, 02-REQ-08).

/** Decimal places of ratios in the run report: interval bounds and point estimates (09-REQ-08, P-13). */
export const RATIO_DECIMALS = 4;

/** Rounds a ratio to RATIO_DECIMALS places (08-REQ-24, 09-REQ-08); never returns -0. */
export function roundRatio(x: number): number {
  return Math.round(x * 1e4) / 1e4 + 0;
}

/** Durations in ms, rounded to 0.1 ms (02-REQ-07). */
export function roundMs(x: number): number {
  return Math.round(x * 10) / 10;
}

// x · 10^(d+6) is first rounded to an integer, which removes float representation errors such
// as 100 · 1.1 = 110.00000000000001: a value within 1e-6 of a whole number at position d counts
// as that whole number (02-REQ-08).
function snap(x: number, digits: number): number {
  return Math.round(x * 10 ** (digits + 6)) / 1e6;
}

/** Rounds up to `digits` decimal places (02-REQ-08): ms limits (0), maxWilson, maxErrorRate (3). */
export function ceilTo(x: number, digits: number): number {
  return Math.ceil(snap(x, digits)) / 10 ** digits;
}

/** Rounds down to `digits` decimal places (02-REQ-08): minApdex (3). */
export function floorTo(x: number, digits: number): number {
  return Math.floor(snap(x, digits)) / 10 ** digits;
}
