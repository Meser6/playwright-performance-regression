// Helpers on thresholds file entries shared by the derivation and the diff (10, chapters 6, 9).
import type { ResolvedConfig } from '../config/index.ts';
import type { ThresholdsEntry } from '../types/index.ts';
import { LIMIT_NAMES } from './types.ts';
import type { CompleteEntry, EntryLimits, LimitName } from './types.ts';

/** Limits in ms; the others are ratios (02-REQ-08). */
const MS_LIMITS: ReadonlySet<LimitName> = new Set<LimitName>(['t', 'median', 'percentile', 'p99']);

/** Limits whose growth may raise THRESHOLDS_LOOSENED_MUCH (10-REQ-20). */
const TIME_LIMITS: readonly LimitName[] = ['median', 'percentile', 'p99'];

/** All seven limit fields are present (02-REQ-21). */
export function isComplete(entry: ThresholdsEntry): entry is CompleteEntry {
  return LIMIT_NAMES.every((name) => entry[name] !== undefined);
}

/** The seven limits of an entry; a missing field is null. */
export function limitsOf(entry: ThresholdsEntry): EntryLimits {
  return {
    t: entry.t ?? null,
    median: entry.median ?? null,
    percentile: entry.percentile ?? null,
    p99: entry.p99 ?? null,
    minApdex: entry.minApdex ?? null,
    maxWilson: entry.maxWilson ?? null,
    maxErrorRate: entry.maxErrorRate ?? null,
  };
}

// a ≤ b on values snapped to 1e-6, so that float noise such as 0.947 − 0.937 =
// 0.010000000000000009 compares as 0.01 (the snapping of 02-REQ-08).
function atMost(a: number, b: number): boolean {
  return Math.round(a * 1e6) <= Math.round(b * 1e6);
}

/**
 * Hysteresis of 10-REQ-18, first condition: every field differs from the new value by at most
 * thresholds.hysteresis.relative of the old value (ms limits) or thresholds.hysteresis.ratio
 * (ratios), and null fields are null in both versions.
 */
export function withinHysteresis(
  before: CompleteEntry,
  after: CompleteEntry,
  hysteresis: ResolvedConfig['thresholds']['hysteresis'],
): boolean {
  return LIMIT_NAMES.every((name) => {
    const a = before[name];
    const b = after[name];
    if (a === null || b === null) return a === b;
    const allowed = MS_LIMITS.has(name) ? hysteresis.relative * a : hysteresis.ratio;
    return atMost(Math.abs(b - a), allowed);
  });
}

/** Direction of a change of one limit (10-REQ-17); null for no change. */
export function changeDirection(
  limit: LimitName,
  before: number | null,
  after: number | null,
): 'looser' | 'stricter' | null {
  if (before === after) return null;
  if (after === null) return 'looser';
  if (before === null) return 'stricter';
  const higher = after > before;
  return (limit === 'minApdex' ? !higher : higher) ? 'looser' : 'stricter';
}

/**
 * A time limit grew by more than thresholds.loosenWarnRelative of its old value in one
 * derivation (10-REQ-20).
 */
export function grewMuch(
  limit: LimitName,
  before: number | null,
  after: number | null,
  loosenWarnRelative: number,
): boolean {
  if (!TIME_LIMITS.includes(limit) || before === null || after === null) return false;
  return !atMost(after - before, loosenWarnRelative * before);
}

/** The entry has a time limit that grew much (10-REQ-20). */
export function loosenedMuch(
  before: ThresholdsEntry,
  after: ThresholdsEntry,
  loosenWarnRelative: number,
): boolean {
  const a = limitsOf(before);
  const b = limitsOf(after);
  return TIME_LIMITS.some((name) => grewMuch(name, a[name], b[name], loosenWarnRelative));
}
