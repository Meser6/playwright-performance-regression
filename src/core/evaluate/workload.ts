// Workload of a key compared with the thresholds run (09, chapter 7a) and the warnings about keys
// whose entry could not be timed (09-REQ-39).
import type { ResolvedConfig } from '../config/index.ts';
import { roundRatio } from '../format/index.ts';
import type { AggregateStats, EvaluatedKey, Issue, Kind, ThresholdsEntry } from '../types/index.ts';
import { THRESHOLDS_COMMAND } from '../types/index.ts';
import { compareText, plural } from './files.ts';

export type Workload = NonNullable<EvaluatedKey['workload']>;

const KIND_NOUN: Record<Kind, string> = { api: 'endpoint', step: 'step' };

/** Keys named in THRESHOLDS_WORKLOAD_SHIFT and THRESHOLDS_ENTRY_NOT_TIMED. */
const KEYS_IN_MESSAGE = 3;
/** Statuses named per key in THRESHOLDS_ENTRY_NOT_TIMED. */
const STATUSES_PER_KEY = 3;
/** A shift needs at least this many samples on one side (09-REQ-41). */
const SHIFT_MIN_SAMPLES = 5;

/** Rounds to 2 decimal places, never -0. */
function round2(x: number): number {
  return Math.round(x * 100) / 100 + 0;
}

/** Current side of the comparison: what evaluate() knows about the run. */
export interface WorkloadRun {
  passes: number;
  workers: number;
  /** Sum of count of all keys of the kind in the run. */
  kindCount: number;
}

/**
 * evaluation.workload of a key (09-REQ-40, 09-REQ-41): null without an entry or without a source
 * block (an entry written by hand or a migrated version 2 file).
 */
export function keyWorkload(
  entry: ThresholdsEntry | undefined,
  stats: AggregateStats,
  run: WorkloadRun,
  factor: ResolvedConfig['thresholds']['workloadShift']['factor'],
): Workload | null {
  const source = entry?.source;
  if (source === undefined) return null;
  const base = {
    count: source.count,
    successCount: source.successCount,
    passes: source.passes,
    workers: 1,
    share: source.share,
  };
  const now = {
    count: stats.count,
    successCount: stats.successCount,
    passes: run.passes,
    workers: run.workers,
    share: run.kindCount === 0 ? 0 : roundRatio(stats.count / run.kindCount),
  };
  const perPassRatio =
    base.count === 0 ? null : round2(now.count / now.passes / (base.count / base.passes));
  const shifted =
    factor !== null &&
    perPassRatio !== null &&
    Math.max(base.count, now.count) >= SHIFT_MIN_SAMPLES &&
    (perPassRatio >= factor || perPassRatio <= 1 / factor);
  return { base, now, perPassRatio, shifted } as Workload;
}

/** Samples per pass with one decimal place, e.g. "4.0". */
function perPass(side: Workload['base']): string {
  return (side.count / side.passes).toFixed(1);
}

/** Size of a change in either direction: ×0.2 and ×5 are equally large. */
function changeSize(ratio: number | null): number {
  if (ratio === null) return 0;
  if (ratio === 0) return Infinity;
  return Math.max(ratio, 1 / ratio);
}

/**
 * THRESHOLDS_WORKLOAD_SHIFT (09-REQ-41): one warning per kind with the keys whose samples per
 * pass changed by thresholds.workloadShift.factor or more; the keys with the largest change
 * first. Null when no key shifted.
 */
export function workloadShiftWarning(
  kind: Kind,
  perKey: Record<string, EvaluatedKey>,
): Issue | null {
  const shifted = Object.entries(perKey)
    .flatMap(([key, e]) => (e.workload?.shifted === true ? [{ key, workload: e.workload }] : []))
    .sort(
      (a, b) =>
        changeSize(b.workload.perPassRatio) - changeSize(a.workload.perPassRatio) ||
        compareText(a.key, b.key),
    );
  if (shifted.length === 0) return null;
  const named = shifted.slice(0, KEYS_IN_MESSAGE).map(({ key, workload }) => {
    const ratio = workload.perPassRatio === null ? '' : ` (×${workload.perPassRatio.toFixed(2)})`;
    return `${key} ${perPass(workload.base)} → ${perPass(workload.now)} samples per pass${ratio}`;
  });
  const rest = shifted.length - named.length;
  const one = shifted.length === 1;
  return {
    code: 'THRESHOLDS_WORKLOAD_SHIFT',
    message: `${plural(shifted.length, `${KIND_NOUN[kind]} key`)} ${one ? 'gets' : 'get'} a different share of the traffic than in the thresholds run: ${named.join(', ')}${rest > 0 ? ` and ${plural(rest, 'other key')}` : ''}.`,
    hint: `A change of the tests or fixtures changes the number of samples and the percentiles; after an intended change, derive thresholds again with \`${THRESHOLDS_COMMAND}\`.`,
  };
}

/** Statuses of a key, most samples first, e.g. "12 × 403, 3 × 200". */
function statusesText(statuses: Record<string, number>): string {
  return Object.entries(statuses)
    .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
    .slice(0, STATUSES_PER_KEY)
    .map(([status, n]) => `${String(n)} × ${status}`)
    .join(', ');
}

/**
 * THRESHOLDS_ENTRY_NOT_TIMED (09-REQ-39), test mode only: keys with an entry that were called at
 * least checks.time.median.minSamples times but have fewer timed samples because their responses
 * were not successful. One warning per kind; null when there is no such key.
 */
export function entryNotTimedWarning(
  kind: Kind,
  perKey: Record<string, EvaluatedKey>,
  aggregates: Record<string, AggregateStats>,
  minSamples: number,
): Issue | null {
  const keys = Object.keys(perKey)
    .filter((key) => {
      const stats = aggregates[key];
      return (
        stats !== undefined &&
        perKey[key]?.thresholdSource === 'file' &&
        stats.count >= minSamples &&
        stats.successCount < minSamples &&
        (stats.nonSuccessCount ?? 0) > 0
      );
    })
    .sort(compareText);
  if (keys.length === 0) return null;
  const named = keys
    .slice(0, KEYS_IN_MESSAGE)
    .map((key) => `${key} (${statusesText(aggregates[key]?.statuses ?? {})})`);
  const rest = keys.length - named.length;
  const one = keys.length === 1;
  return {
    code: 'THRESHOLDS_ENTRY_NOT_TIMED',
    message: `${plural(keys.length, `${KIND_NOUN[kind]} key`)} with thresholds ${one ? 'was' : 'were'} not timed because ${one ? 'its' : 'their'} responses were not successful: ${named.join(', ')}${rest > 0 ? ` and ${plural(rest, 'other key')}` : ''}.`,
    hint: 'Check the login and the test data of the tests that call these keys. The nonSuccess rule fails such a key when its entry has maxNonSuccessRate (written by a thresholds run of version 1.1.0 or later).',
  };
}
