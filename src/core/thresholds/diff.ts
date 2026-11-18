// Diff of the old and the new thresholds file of one kind (10, chapter 9).
import type { ResolvedConfig } from '../config/index.ts';
import type { LoadedThresholdsFile } from '../evaluate/index.ts';
import { compareText } from '../evaluate/files.ts';
import { dayOf, keyMuting } from '../evaluate/muting.ts';
import type { AggregateStats, RunReport, ThresholdsEntry } from '../types/index.ts';
import { aggregatesOf } from './derive.ts';
import { changeDirection, grewMuch, isComplete, limitsOf } from './entries.ts';
import { deriveEntry, isDerivable } from './formulas.ts';
import { DIFF_CATEGORIES, LIMIT_NAMES } from './types.ts';
import type { DerivedFile, DiffCategory, KeyDiff, LimitChange, ThresholdsDiff } from './types.ts';

type DiffConfig = Pick<ResolvedConfig, 'checks' | 'thresholds'>;

function limitChanges(
  before: ThresholdsEntry,
  after: ThresholdsEntry,
  loosenWarnRelative: number,
): LimitChange[] {
  const a = limitsOf(before);
  const b = limitsOf(after);
  const changes: LimitChange[] = [];
  for (const limit of LIMIT_NAMES) {
    const direction = changeDirection(limit, a[limit], b[limit]);
    if (direction === null) continue;
    const change: LimitChange = { limit, before: a[limit], after: b[limit], direction };
    if (grewMuch(limit, a[limit], b[limit], loosenWarnRelative)) change.large = true;
    changes.push(change);
  }
  return changes;
}

/** Category of a key present in both versions of the file (10-REQ-16). */
function keptKey(
  key: string,
  before: ThresholdsEntry,
  after: ThresholdsEntry,
  stats: AggregateStats | undefined,
  kind: ThresholdsDiff['kind'],
  cfg: DiffConfig,
): KeyDiff {
  if (stats === undefined) return { key, category: 'unseen', changes: [] };
  if (before.locked === true || !isComplete(before)) {
    return {
      key,
      category: 'locked',
      changes: [],
      ...(isComplete(before) ? {} : { incomplete: true as const }),
    };
  }
  if (!isDerivable(stats, cfg.checks)) return { key, category: 'skipped', changes: [] };
  const changes = limitChanges(before, after, cfg.thresholds.loosenWarnRelative);
  if (changes.length > 0) {
    const looser = changes.some((c) => c.direction === 'looser');
    const stricter = changes.some((c) => c.direction === 'stricter');
    const category: DiffCategory = looser && stricter ? 'mixed' : looser ? 'loosened' : 'tightened';
    return { key, category, changes };
  }
  // Unchanged although a fresh derivation differs: kept by hysteresis (10-REQ-18).
  const fresh = cfg.thresholds.update === 'all' ? deriveEntry(stats, kind, cfg) : null;
  const old = limitsOf(before);
  const kept = fresh !== null && LIMIT_NAMES.some((name) => fresh[name] !== old[name]);
  return { key, category: 'unchanged', changes: [], ...(kept ? { withinHysteresis: true } : {}) };
}

/**
 * Diff of one thresholds file (10-REQ-16, 10-REQ-17, 10-REQ-20, 10-REQ-21): every key of both
 * versions of the file, and every key of the run with too few samples, in exactly one category.
 * The report tells unseen and skipped keys from unchanged ones; `cfg` is the config of the
 * derivation (minimum samples, update mode, hysteresis and loosenWarnRelative).
 */
export function diffThresholds(
  before: LoadedThresholdsFile,
  after: DerivedFile,
  report: RunReport,
  cfg: DiffConfig,
): ThresholdsDiff {
  const kind = after.kind;
  const old = before.status === 'loaded' ? before.file.entries : {};
  const now = after.content === null ? old : after.content.entries;
  const aggregates = aggregatesOf(report, kind);
  const runDay = dayOf(report.startedAt);
  const keys = new Set([...Object.keys(old), ...Object.keys(now)]);
  for (const [key, stats] of Object.entries(aggregates)) {
    if (!isDerivable(stats, cfg.checks)) keys.add(key);
  }

  const diffs: KeyDiff[] = [];
  for (const key of [...keys].sort(compareText)) {
    const b = Object.hasOwn(old, key) ? old[key] : undefined;
    const a = Object.hasOwn(now, key) ? now[key] : undefined;
    const stats = Object.hasOwn(aggregates, key) ? aggregates[key] : undefined;
    let diff: KeyDiff;
    if (b !== undefined && a !== undefined) {
      diff = keptKey(key, b, a, stats, kind, cfg);
    } else if (a !== undefined) {
      diff = { key, category: 'added', changes: [], limits: limitsOf(a) };
    } else if (b !== undefined) {
      diff = { key, category: 'removed', changes: [], limits: limitsOf(b) };
    } else {
      diff = { key, category: 'skipped', changes: [] };
    }
    const entry = a ?? b;
    const muting = entry === undefined ? null : keyMuting(entry, runDay);
    if (muting !== null) diff.muted = { until: muting.until, expired: muting.expired };
    diffs.push(diff);
  }

  const counts = Object.fromEntries(DIFF_CATEGORIES.map((c) => [c, 0])) as Record<
    DiffCategory,
    number
  >;
  for (const diff of diffs) counts[diff.category] += 1;
  return {
    kind,
    fileStatus:
      after.content === null
        ? 'not-written'
        : !after.changed
          ? 'unchanged'
          : before.status === 'loaded'
            ? 'updated'
            : 'created',
    level: cfg.checks.time.percentile.level,
    keys: diffs,
    counts,
  };
}
