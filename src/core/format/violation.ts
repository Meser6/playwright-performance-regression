// Texts of a failed check shared by the console violation table (09-REQ-19) and junit.xml
// (16-REQ-09): relative exceedance, the `over` column and the formatted actual and limit values.
import type { Check } from '../types/index.ts';

const TIME_RULES: ReadonlySet<Check['rule']> = new Set<Check['rule']>([
  'median',
  'percentile',
  'p99',
]);

/** Rules on shares: the excess is in percentage points (09-REQ-19, 09-D-20). */
const SHARE_RULES: ReadonlySet<Check['rule']> = new Set<Check['rule']>([
  'apdex',
  'wilson',
  'errors',
]);

/**
 * Relative exceedance r of a failed check (09-REQ-19, 09-REQ-20): actual / limit for rules
 * failing on `>`, limit / actual for apdex; Infinity when the divisor is 0.
 */
export function exceedance(check: Pick<Check, 'rule' | 'actual' | 'limit'>): number {
  if (check.rule === 'apdex') return check.actual === 0 ? Infinity : check.limit / check.actual;
  return check.limit === 0 ? Infinity : check.actual / check.limit;
}

/**
 * Column `over`: max(1, Math.round((r − 1) · 100)) with "+" and "%", or ">999%" (09-REQ-19,
 * 09-D-15); for the share rules the difference in percentage points, at least 1: "+81 pp"
 * (09-D-20). The HTML report shows the same text with " over" (11-REQ-30, 11-D-27).
 */
export function overText(check: Pick<Check, 'rule' | 'actual' | 'limit'>): string {
  if (SHARE_RULES.has(check.rule)) {
    const points = Math.max(1, Math.round(Math.abs(check.actual - check.limit) * 100));
    return `+${String(points)} pp`;
  }
  const r = exceedance(check);
  if (!Number.isFinite(r)) return '>999%';
  const over = Math.max(1, Math.round((r - 1) * 100));
  return over > 999 ? '>999%' : `+${String(over)}%`;
}

/**
 * A multiple of a limit with two decimals, rounded, e.g. 2.6733 → "2.67" (11-REQ-34, 11-D-27).
 * When the rounded value is not above `threshold` (the hard limit factor it is compared with),
 * it is rounded up instead, so a text never reads "2.00× … above the hard limit of 2×".
 */
export function formatFactor(ratio: number, threshold: number | null = null): string {
  // ratio · 10⁶ is rounded first, which removes float errors such as 2.05 · 100 = 204.99999….
  const scaled = Math.round(ratio * 1e6) / 1e4;
  let hundredths = Math.round(scaled);
  if (threshold !== null && hundredths / 100 <= threshold && ratio > threshold) {
    hundredths = Math.ceil(scaled);
  }
  return (hundredths / 100).toFixed(2);
}

/** A duration in whole milliseconds: "412 ms". */
export function formatMs(ms: number): string {
  return `${Math.round(ms)} ms`;
}

/** Column `actual`: ms for time rules, else the bound with the observed value: "0.781 (0.812)". */
export function formatActual(check: Pick<Check, 'rule' | 'actual' | 'observed'>): string {
  if (TIME_RULES.has(check.rule)) return formatMs(check.actual);
  const observed = check.observed === null ? '' : ` (${check.observed.toFixed(3)})`;
  return `${check.actual.toFixed(3)}${observed}`;
}

/** Column `limit`: ms for time rules, else 3 decimal places. */
export function formatLimit(check: Pick<Check, 'rule' | 'limit'>): string {
  return TIME_RULES.has(check.rule) ? formatMs(check.limit) : check.limit.toFixed(3);
}
