// Muting of a key in the thresholds file (09, chapter 6.5; D-25).
import type { Issue, KeyEvaluation, Kind, ThresholdsEntry } from '../types/index.ts';
import { plural } from './files.ts';

/** Days before `until` from which THRESHOLDS_MUTE_EXPIRING is reported (09-REQ-26, P-13). */
export const MUTE_EXPIRY_WARN_DAYS = 7;

const DAY_MS = 86_400_000;

export type Muting = NonNullable<KeyEvaluation['muted']>;

export interface MutedKey {
  kind: Kind;
  key: string;
  muted: Muting;
}

/** UTC day (YYYY-MM-DD) of an ISO timestamp such as RunReport.startedAt. */
export function dayOf(timestamp: string): string {
  const time = Date.parse(timestamp);
  if (Number.isNaN(time)) throw new Error(`evaluate: invalid startedAt "${timestamp}"`);
  return new Date(time).toISOString().slice(0, 10);
}

/** Whole UTC calendar days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * Muting of a file entry; null without `gate: "warn"`. Expired when the run started on a later
 * UTC day than `until`: the day of `until` still mutes (09-REQ-26).
 */
export function keyMuting(entry: ThresholdsEntry, runDay: string): Muting | null {
  if (entry.gate !== 'warn' || entry.until === undefined) return null;
  return {
    until: entry.until,
    note: entry.note ?? '',
    expired: daysBetween(entry.until, runDay) > 0,
  };
}

/** Active muting: set and not expired (09-REQ-13, step 2). */
export function isMuteActive(muted: KeyEvaluation['muted']): boolean {
  return muted !== null && !muted.expired;
}

function keyList(keys: readonly MutedKey[]): string {
  return keys.map(({ kind, key, muted }) => `${kind} ${key} (until ${muted.until})`).join(', ');
}

/** THRESHOLDS_MUTED, THRESHOLDS_MUTE_EXPIRING and THRESHOLDS_MUTE_EXPIRED (09-REQ-26). */
export function mutingWarnings(keys: readonly MutedKey[], runDay: string): Issue[] {
  const active = keys.filter((k) => !k.muted.expired);
  const expiring = active.filter(
    (k) => daysBetween(runDay, k.muted.until) <= MUTE_EXPIRY_WARN_DAYS,
  );
  const expired = keys.filter((k) => k.muted.expired);
  const issues: Issue[] = [];
  if (active.length > 0) {
    issues.push({
      code: 'THRESHOLDS_MUTED',
      message: `${plural(active.length, 'key is', 'keys are')} muted; ${active.length === 1 ? 'its' : 'their'} violations do not block.`,
      hint: 'Muted keys are listed with their note and end date; remove gate and until from the entry once the cause is fixed.',
    });
  }
  if (expiring.length > 0) {
    issues.push({
      code: 'THRESHOLDS_MUTE_EXPIRING',
      message: `Muting ends within ${MUTE_EXPIRY_WARN_DAYS} days for ${plural(expiring.length, 'key')}: ${keyList(expiring)}.`,
      hint: 'Fix the cause before the end date, or extend until in the thresholds file on purpose.',
    });
  }
  if (expired.length > 0) {
    issues.push({
      code: 'THRESHOLDS_MUTE_EXPIRED',
      message: `Muting expired for ${plural(expired.length, 'key')}, so ${expired.length === 1 ? 'it blocks' : 'they block'} again: ${keyList(expired)}.`,
      hint: 'Remove gate and until from the entry, or extend until on purpose.',
    });
  }
  return issues;
}
