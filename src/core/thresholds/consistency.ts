// Self-consistency of an entry with its source aggregate (10-REQ-05, 10-REQ-18, 10-D-19).
import type { ResolvedConfig } from '../config/index.ts';
import { entryLimits } from '../evaluate/index.ts';
import { runRules } from '../evaluate/rules.ts';
import type { AggregateStats, Kind, ThresholdsEntry } from '../types/index.ts';
import { withPercentile } from './formulas.ts';

type Checks = ResolvedConfig['checks'];

/** The rule settings with every rule enabled and no minimum sample count. */
function allRulesOn(checks: Checks): Checks {
  const on = <R extends { enabled: boolean; minSamples: number }>(rule: R): R => ({
    ...rule,
    enabled: true,
    minSamples: 0,
  });
  return {
    time: {
      median: on(checks.time.median),
      percentile: on(checks.time.percentile),
      p99: on(checks.time.p99),
    },
    slowShare: {
      t: checks.slowShare.t,
      apdex: on(checks.slowShare.apdex),
      wilson: on(checks.slowShare.wilson),
    },
    errors: on(checks.errors),
  };
}

/**
 * 10-REQ-18: every non-null limit of the entry passes the 09 comparison on the source aggregate,
 * regardless of rule enabled/minSamples; pure. The comparison is the one of the evaluation
 * (runRules): the same values, interval bounds and rounding. A rule without samples has nothing
 * to compare and does not count against the entry.
 */
export function entrySelfConsistent(
  entry: ThresholdsEntry,
  aggregate: AggregateStats,
  kind: Kind,
  cfg: Pick<ResolvedConfig, 'checks' | 'gate'>,
): boolean {
  const checks = allRulesOn(cfg.checks);
  const stats = withPercentile(aggregate, checks.time.percentile.level);
  const { checks: results } = runRules(stats, entryLimits(entry, cfg.checks, kind), {
    checks,
    gate: cfg.gate,
  });
  return results.every((check) => check.passed);
}
