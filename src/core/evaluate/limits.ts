// Limits applied to a key (09-REQ-06, 02-REQ-21).
import type { ResolvedConfig } from '../config/index.ts';
import type { KeyEvaluation, Kind, ThresholdsEntry } from '../types/index.ts';

export type Limits = KeyEvaluation['limits'];

/** Default thresholds: time and error limits from checks.*.limit; apdex and wilson off (09-D-12). */
export function defaultLimits(checks: ResolvedConfig['checks'], kind: Kind): Limits {
  return {
    t: null,
    median: checks.time.median.limit[kind],
    percentile: checks.time.percentile.limit[kind],
    p99: checks.time.p99.limit[kind],
    minApdex: null,
    maxWilson: null,
    maxErrorRate: checks.errors.limit[kind],
  };
}

/**
 * Limits of a thresholds file entry, completed from the config (02-REQ-21): missing time and
 * error limits from checks.*.limit; without t the apdex and wilson limits are null; with t a
 * missing minApdex or maxWilson comes from checks.slowShare.*.limit. An explicit null is kept.
 */
export function entryLimits(
  entry: ThresholdsEntry,
  checks: ResolvedConfig['checks'],
  kind: Kind,
): Limits {
  const defaults = defaultLimits(checks, kind);
  const t = entry.t ?? null;
  return {
    t,
    median: entry.median ?? defaults.median,
    percentile: entry.percentile ?? defaults.percentile,
    p99: entry.p99 ?? defaults.p99,
    minApdex:
      t === null
        ? null
        : entry.minApdex === undefined
          ? checks.slowShare.apdex.limit[kind]
          : entry.minApdex,
    maxWilson:
      t === null
        ? null
        : entry.maxWilson === undefined
          ? checks.slowShare.wilson.limit[kind]
          : entry.maxWilson,
    maxErrorRate: entry.maxErrorRate ?? defaults.maxErrorRate,
  };
}
