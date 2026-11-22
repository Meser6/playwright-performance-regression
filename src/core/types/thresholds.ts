// Types of the thresholds derivation and the diff report (10, chapter 10), with the display
// names of the limits shared by the console and the Markdown diff (10, chapter 9.1).
import type { Entry as ThresholdsEntry, Issue, ThresholdsFile } from './generated/formats.ts';

type Kind = 'api' | 'step';

export type LimitName =
  't' | 'median' | 'percentile' | 'p99' | 'minApdex' | 'maxWilson' | 'maxErrorRate';

/** The seven limit fields of a complete entry (02-REQ-21), in file order. */
export const LIMIT_NAMES: readonly LimitName[] = [
  't',
  'median',
  'percentile',
  'p99',
  'minApdex',
  'maxWilson',
  'maxErrorRate',
];

/** Limits of a complete entry. */
export type EntryLimits = Record<LimitName, number | null>;

/** A complete entry as the generator writes it (02-REQ-21): all seven limit fields set. */
export type CompleteEntry = ThresholdsEntry & {
  t: number | null;
  median: number;
  percentile: number;
  p99: number;
  minApdex: number | null;
  maxWilson: number | null;
  maxErrorRate: number;
};

export interface DeriveOptions {
  /** Current environment label, after the --env flag. */
  env: string | null;
  /** PW_PERF_PRUNE=1: remove unlocked entries of keys not seen in the run (10-REQ-10). */
  prune: boolean;
  /** Version of this package, written to generated.tool. */
  toolVersion: string;
}

export interface DerivedFile {
  kind: Kind;
  /** null: this kind is not written (10-REQ-14). */
  content: ThresholdsFile | null;
  /** The file must be written (10-REQ-12). When false, content is the existing file unchanged. */
  changed: boolean;
}

export interface DerivedThresholds {
  /** In kind order (api first). */
  files: DerivedFile[];
  warnings: Issue[];
}

export type DiffCategory =
  | 'added'
  | 'removed'
  | 'loosened'
  | 'tightened'
  | 'mixed'
  | 'unchanged'
  | 'locked'
  | 'unseen'
  | 'skipped';

/** Category order of the counters and the change list (10, chapter 9.1). */
export const DIFF_CATEGORIES: readonly DiffCategory[] = [
  'added',
  'removed',
  'loosened',
  'tightened',
  'mixed',
  'unchanged',
  'locked',
  'unseen',
  'skipped',
];

export interface LimitChange {
  limit: LimitName;
  before: number | null;
  after: number | null;
  direction: 'looser' | 'stricter';
  /** 10-REQ-20: median/percentile/p99 grew by more than thresholds.loosenWarnRelative. */
  large?: true;
}

export interface KeyDiff {
  key: string;
  category: DiffCategory;
  /** Empty unless loosened / tightened / mixed. */
  changes: LimitChange[];
  /**
   * Limits of the added entry (added) or of the removed entry (removed), so the diff can show
   * them; absent for the other categories.
   */
  limits?: EntryLimits;
  /** Locked because the entry is incomplete (10-REQ-08). */
  incomplete?: true;
  /** Unchanged because of 10-REQ-18. */
  withinHysteresis?: true;
  /** 10-REQ-21: muting of the entry; expired relative to the source report's startedAt. */
  muted?: { until: string; expired: boolean };
  /** Skipped keys of the run: why no entry was derived (10, chapter 9.1, 10-D-21). */
  samples?: SkippedSamples;
}

export interface SkippedSamples {
  /** Successful samples of the key. */
  success: number;
  /** All samples of the key. */
  count: number;
  /** Successful samples a derived entry needs (checks.time.median.minSamples). */
  needed: number;
  /** Samples per status. */
  statuses: Record<string, number>;
}

/** Statuses shown in the reason of a skipped key. */
const SKIPPED_STATUSES = 3;

/**
 * Why a key was skipped (10, chapter 9.1): `2 successful samples, 5 needed`, with the statuses
 * when some samples were not successful: `no successful samples, 5 needed (5 × 404)`.
 */
export function skippedReasonText(samples: SkippedSamples): string {
  const success =
    samples.success === 0
      ? 'no successful samples'
      : `${String(samples.success)} successful sample${samples.success === 1 ? '' : 's'}`;
  let text = `${success}, ${String(samples.needed)} needed`;
  if (samples.count > samples.success) {
    const statuses = Object.entries(samples.statuses)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .slice(0, SKIPPED_STATUSES)
      .map(([status, n]) => `${String(n)} × ${status}`);
    if (statuses.length > 0) text += ` (${statuses.join(', ')})`;
  }
  return text;
}

export interface ThresholdsDiff {
  kind: Kind;
  fileStatus: 'created' | 'updated' | 'unchanged' | 'not-written';
  /** Evaluated percentile the `percentile` limit refers to, e.g. "p95" (for display). */
  level: string;
  /** Sorted by key. */
  keys: KeyDiff[];
  counts: Record<DiffCategory, number>;
}

/**
 * Short name of a limit in the diff output: the evaluated percentile (e.g. "p95") for
 * `percentile`, the rule name for the ratio limits (10, chapter 9.1).
 */
export function limitLabel(limit: LimitName, level: string): string {
  switch (limit) {
    case 'percentile':
      return level;
    case 't':
      return 'apdex T';
    case 'minApdex':
      return 'apdex';
    case 'maxWilson':
      return 'wilson';
    case 'maxErrorRate':
      return 'errors';
    default:
      return limit;
  }
}

/** A limit value in the diff output: ms as integers, ratios with 3 places, null as "null". */
export function limitValueText(limit: LimitName, value: number | null): string {
  if (value === null) return 'null';
  if (limit === 't') return `${String(value)} ms`;
  return limit === 'median' || limit === 'percentile' || limit === 'p99'
    ? String(value)
    : value.toFixed(3);
}

const MARKERS: Record<DiffCategory, string> = {
  added: '+',
  removed: '-',
  loosened: '↑',
  tightened: '↓',
  mixed: '±',
  unchanged: '=',
  locked: '#',
  unseen: '?',
  skipped: '.',
};

/** Marker of a key in the change list: + - ↑ ↓ ±, with "!" for a large loosening (10-REQ-20). */
export function diffMarker(diff: KeyDiff): string {
  const large = diff.changes.some((c) => c.large === true);
  return `${MARKERS[diff.category]}${large ? '!' : ''}`;
}

/** Categories listed with their values; the others are counters only (10, chapter 9.1). */
export const LISTED_CATEGORIES: ReadonlySet<DiffCategory> = new Set<DiffCategory>([
  'added',
  'removed',
  'loosened',
  'tightened',
  'mixed',
]);

/** Category counters of one file, e.g. "3 added · 30 unchanged (18 within hysteresis)". */
export function diffCountsText(diff: ThresholdsDiff): string {
  const parts: string[] = [];
  for (const category of DIFF_CATEGORIES) {
    const n = diff.counts[category];
    if (n === 0) continue;
    let extra = '';
    if (category === 'unchanged') {
      const kept = diff.keys.filter((k) => k.withinHysteresis === true).length;
      if (kept > 0) extra = ` (${kept} within hysteresis)`;
    } else if (category === 'locked') {
      const incomplete = diff.keys.filter((k) => k.incomplete === true).length;
      if (incomplete > 0)
        extra = ` (${incomplete} incomplete ${incomplete === 1 ? 'entry' : 'entries'})`;
    }
    parts.push(`${n} ${category}${extra}`);
  }
  return parts.length === 0 ? 'no entries' : parts.join(' · ');
}

/** Values of one side of a listed key, e.g. "p95 1400  p99 1700" (joined by `separator`). */
export function diffValuesText(
  diff: KeyDiff,
  side: 'before' | 'after',
  level: string,
  separator: string,
): string {
  if (diff.limits !== undefined) {
    const shown = (diff.category === 'added') === (side === 'after');
    if (!shown) return '';
    const limits = diff.limits;
    return LIMIT_NAMES.map(
      (name) => `${limitLabel(name, level)} ${limitValueText(name, limits[name])}`,
    ).join(separator);
  }
  return diff.changes
    .map((c) => `${limitLabel(c.limit, level)} ${limitValueText(c.limit, c[side])}`)
    .join(separator);
}

/** Change text of a listed key, e.g. "p95 1400 → 1620  p99 1700 → 1950" or the added values. */
export function diffChangeText(diff: KeyDiff, level: string, separator: string): string {
  if (diff.limits !== undefined) {
    return diffValuesText(diff, diff.category === 'added' ? 'after' : 'before', level, separator);
  }
  return diff.changes
    .map(
      (c) =>
        `${limitLabel(c.limit, level)} ${limitValueText(c.limit, c.before)} → ${limitValueText(c.limit, c.after)}`,
    )
    .join(separator);
}
