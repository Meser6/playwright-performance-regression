// Formulas of a derived entry (10, chapter 5) and the inputs they use (10-REQ-01).
import type { ResolvedConfig } from '../config/index.ts';
import { ceilTo, floorTo, roundMs } from '../format/index.ts';
import {
  apdex,
  exceedingShare,
  percentile,
  percentileNames,
  wilsonBounds,
} from '../stats/index.ts';
import type { AggregateStats, DerivationSettings, Kind } from '../types/index.ts';
import { ERR_SELF_GAP, WILSON_SELF_GAP } from './constants.ts';
import type { CompleteEntry } from './types.ts';

type Checks = ResolvedConfig['checks'];
type DeriveConfig = Pick<ResolvedConfig, 'checks' | 'thresholds'>;

/** Successful samples a key needs for a derived entry (10-REQ-02); at least one. */
export function minDeriveSamples(checks: Checks): number {
  return Math.max(1, checks.time.median.minSamples);
}

/** The key has enough successful samples for a derived entry (10-REQ-02). */
export function isDerivable(stats: AggregateStats, checks: Checks): boolean {
  return stats.stats !== null && stats.successCount >= minDeriveSamples(checks);
}

/**
 * The aggregate with the evaluated percentile `level` in stats.percentiles: a report without it
 * (e.g. after a change of checks.time.percentile.level) gets it computed
 * from samples.durations with the function of 08 and rounded as in the report (10-REQ-01).
 */
export function withPercentile(stats: AggregateStats, level: string): AggregateStats {
  if (stats.stats === null || stats.stats.percentiles[level] !== undefined) return stats;
  const p = percentileNames(level).find(([name]) => name === level)?.[1];
  const durations = [...stats.samples.durations].sort((a, b) => a - b);
  const value = p === undefined ? null : percentile(durations, p);
  if (value === null) return stats;
  return {
    ...stats,
    stats: { ...stats.stats, percentiles: { ...stats.stats.percentiles, [level]: roundMs(value) } },
  };
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

/** generated.derivation: the settings the formulas used for this kind (10-REQ-11). */
export function derivationSettings(cfg: DeriveConfig, kind: Kind): DerivationSettings {
  const { time, slowShare, errors, nonSuccess } = cfg.checks;
  return structuredClone({
    t: slowShare.t[kind],
    smallSampleN: cfg.thresholds.smallSampleN,
    margins: {
      median: time.median.margin,
      percentile: time.percentile.margin,
      p99: time.p99.margin,
      apdex: slowShare.apdex.margin,
      wilson: slowShare.wilson.margin,
      errors: errors.margin,
      // Endpoint files only: steps have no nonSuccess limit (10-REQ-25).
      ...(kind === 'api' ? { nonSuccess: nonSuccess.margin } : {}),
    },
  });
}

/** min(1, max(r × factor + add, min, rLow + ERR_SELF_GAP)) rounded up (10, chapter 5). */
function rateLimit(
  k: number,
  bigN: number,
  margin: ResolvedConfig['checks']['errors']['margin'],
): number {
  const r = bigN === 0 ? 0 : k / bigN;
  const low = wilsonBounds(k, bigN)?.lower ?? 0;
  return ceilTo(
    Math.min(1, Math.max(r * margin.factor + margin.add, margin.min, low + ERR_SELF_GAP)),
    3,
  );
}

/**
 * Derived entry of one key (10, chapter 5): all seven limits, rounded and computed in the order
 * of 10-REQ-03, and maxNonSuccessRate for endpoint keys (10-REQ-25). Pure; the caller checks
 * isDerivable() first.
 */
export function deriveEntry(stats: AggregateStats, kind: Kind, cfg: DeriveConfig): CompleteEntry {
  const level = cfg.checks.time.percentile.level;
  const source = withPercentile(stats, level).stats;
  if (source === null) throw new Error('deriveEntry: aggregate has no successful samples');
  const at = (name: string): number => {
    const value = source.percentiles[name];
    if (value === undefined) throw new Error(`deriveEntry: aggregate has no percentile "${name}"`);
    return value;
  };
  const { time, slowShare, errors, nonSuccess } = cfg.checks;
  const T = slowShare.t[kind];
  const n = stats.successCount;
  const small = n < cfg.thresholds.smallSampleN;
  const p50 = at('p50');
  const p90 = at('p90');
  const p99 = at('p99');
  const pE = at(level);
  const durations = [...stats.samples.durations].sort((a, b) => a - b);

  // 1. t: null above T.max (10-REQ-06, 10-D-13).
  const t =
    p50 > T.max ? null : ceilTo(clamp(Math.min(p90, T.medianFactor * p50), T.min, T.max), 0);

  // 2.–4. Time limits; each uses the rounded limit of the row above (10-REQ-03, 10-D-18).
  const rMedian = small ? time.median.margin.smallSampleRelative : time.median.margin.relative;
  const median = ceilTo(Math.max(p50 * (1 + rMedian), p50 + time.median.margin.minMs), 0);
  const pMargin = time.percentile.margin;
  const rPercentile = small ? pMargin.smallSampleRelative : pMargin.relative;
  const percentileLimit = ceilTo(Math.max(pE * (1 + rPercentile), pE + pMargin.minMs, median), 0);
  const p99Margin = time.p99.margin;
  const p99Limit = ceilTo(
    Math.max(
      p99 * (1 + p99Margin.relative),
      percentileLimit + Math.max(p99Margin.minGapMs, p99Margin.minGapRelative * percentileLimit),
    ),
    0,
  );

  // 5.–6. Slow-share limits with the rounded t.
  let minApdex: number | null = null;
  let maxWilson: number | null = null;
  if (t !== null) {
    const apdexMargin = slowShare.apdex.margin;
    const score = apdex(durations, t) ?? 0;
    minApdex = floorTo(
      Math.max(0, score - (small ? apdexMargin.smallSampleAbsolute : apdexMargin.absolute)),
      3,
    );
    const w = slowShare.wilson.margin;
    const { k, n: m } = exceedingShare(durations, t);
    const s = m === 0 ? 0 : k / m;
    const wLow = wilsonBounds(k, m)?.lower ?? 0;
    maxWilson = ceilTo(
      Math.min(
        1,
        Math.max(
          clamp(s * w.factor + w.add, w.min, w.max),
          small ? w.smallSampleMin : 0,
          wLow + WILSON_SELF_GAP,
        ),
      ),
      3,
    );
  }

  // 7. Errors: e = errorCount / N with N = count (10-REQ-01).
  const bigN = stats.count;
  const maxErrorRate = rateLimit(stats.errorCount, bigN, errors.margin);

  const entry: CompleteEntry = {
    t,
    median,
    percentile: percentileLimit,
    p99: p99Limit,
    minApdex,
    maxWilson,
    maxErrorRate,
  };
  // 8. Endpoint keys: u = nonSuccessCount / N (10-REQ-25); 1 for a key that never succeeds.
  if (kind === 'api' && stats.nonSuccessCount !== null) {
    entry.maxNonSuccessRate = rateLimit(stats.nonSuccessCount, bigN, nonSuccess.margin);
  }
  return entry;
}
