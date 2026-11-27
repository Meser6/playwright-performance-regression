// Limits applied to a key (09-REQ-06, 02-REQ-21).
import type { ResolvedConfig } from '../config/index.ts';
import type { KeyEvaluation, Kind, ThresholdsEntry } from '../types/index.ts';

export type Limits = KeyEvaluation['limits'];

/**
 * Limit of the nonSuccess rule without an entry value: checks.nonSuccess.limit.api for endpoint
 * keys (null by default, so the rule does not run); steps have no such rule (09-REQ-38).
 */
function defaultNonSuccess(checks: ResolvedConfig['checks'], kind: Kind): number | null {
  return kind === 'api' ? checks.nonSuccess.limit.api : null;
}

/**
 * Default thresholds: time and error limits from checks.*.limit; apdex and wilson off (09-D-12);
 * nonSuccess only with checks.nonSuccess.limit.api set (09-REQ-38).
 */
export function defaultLimits(checks: ResolvedConfig['checks'], kind: Kind): Limits {
  return {
    t: null,
    median: checks.time.median.limit[kind],
    percentile: checks.time.percentile.limit[kind],
    p99: checks.time.p99.limit[kind],
    minApdex: null,
    maxWilson: null,
    maxErrorRate: checks.errors.limit[kind],
    maxNonSuccessRate: defaultNonSuccess(checks, kind),
  };
}

/**
 * Limits of a thresholds file entry, completed from the config (02-REQ-21): missing time and
 * error limits from checks.*.limit; without t the apdex and wilson limits are null; with t a
 * missing minApdex or maxWilson comes from checks.slowShare.*.limit. An explicit null is kept.
 * A missing maxNonSuccessRate comes from checks.nonSuccess.limit.api (endpoint keys only).
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
    // An entry of a migrated version 2 file has no maxNonSuccessRate (09-REQ-38).
    maxNonSuccessRate:
      kind === 'api' ? (entry.maxNonSuccessRate ?? defaults.maxNonSuccessRate) : null,
  };
}
