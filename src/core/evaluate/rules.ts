// Rules of the evaluation of one key (09, chapter 5.2).
import type { ResolvedConfig } from '../config/index.ts';
import { roundRatio } from '../format/index.ts';
import { apdex, apdexCounts, exceedingShare, wilsonBounds } from '../stats/index.ts';
import type { AggregateStats, Check } from '../types/index.ts';
import type { Limits } from './limits.ts';

export type Rule = Check['rule'];

/** Rule order in `checks` (09, table in 5.2). */
export const RULES: readonly Rule[] = ['median', 'percentile', 'p99', 'apdex', 'wilson', 'errors'];

export const TIME_RULES: ReadonlySet<Rule> = new Set<Rule>(['median', 'percentile', 'p99']);

export interface RuleOutcome {
  /** Checks that ran, in RULES order; `blocking` is set later by the gate (09-REQ-13). */
  checks: Check[];
  /** At least one rule was enabled and had all its limits (09-REQ-10). */
  applicable: boolean;
}

interface RuleInput {
  enabled: boolean;
  minSamples: number;
  /** Limits the rule needs are all set (09-REQ-07). */
  hasLimits: boolean;
  /** Sample count compared with minSamples: n, or N for errors (09-REQ-07). */
  count: number;
  run: () => Omit<Check, 'hardLimitExceeded' | 'blocking'>;
}

function timeCheck(
  rule: Rule,
  actual: number,
  limit: number,
  m: number,
): Omit<Check, 'hardLimitExceeded' | 'blocking'> {
  // Strict comparison on the value as written in the report (09-REQ-08).
  return { rule, n: m, actual, observed: null, limit, passed: !(actual > limit) };
}

/**
 * Runs the rules of 09, 5.2 for one aggregate. Values compared are those written in the report:
 * durations rounded to 0.1 ms (already so in the aggregate) and ratios to RATIO_DECIMALS places.
 */
export function runRules(
  stats: AggregateStats,
  limits: Limits,
  cfg: Pick<ResolvedConfig, 'checks' | 'gate'>,
): RuleOutcome {
  const { time, slowShare, errors } = cfg.checks;
  const n = stats.successCount;
  const bigN = stats.count;
  const durations = [...stats.samples.durations].sort((a, b) => a - b);
  const m = durations.length;
  const percentiles = stats.stats?.percentiles ?? {};
  const at = (name: string): number => {
    const value = percentiles[name];
    if (value === undefined) {
      throw new Error(`evaluate: aggregate has no percentile "${name}"`);
    }
    return value;
  };
  const t = limits.t;

  const inputs: RuleInput[] = [
    {
      ...time.median,
      hasLimits: true,
      count: n,
      run: () => timeCheck('median', at('p50'), limits.median, m),
    },
    {
      ...time.percentile,
      hasLimits: true,
      count: n,
      run: () => timeCheck('percentile', at(time.percentile.level), limits.percentile, m),
    },
    {
      ...time.p99,
      hasLimits: true,
      count: n,
      run: () => timeCheck('p99', at('p99'), limits.p99, m),
    },
    {
      ...slowShare.apdex,
      hasLimits: t !== null && limits.minApdex !== null,
      count: n,
      run: () => {
        const tt = t ?? 0;
        const limit = limits.minApdex ?? 0;
        // Upper bound for the Apdex score with the exact k = S + U / 2 (09-REQ-09, 09-D-11).
        const { s, u } = apdexCounts(durations, tt);
        const actual = wilsonBounds(s + u / 2, m)?.upper ?? 0;
        return {
          rule: 'apdex',
          n: m,
          actual,
          observed: apdex(durations, tt),
          limit,
          passed: !(actual < limit),
        };
      },
    },
    {
      ...slowShare.wilson,
      hasLimits: t !== null && limits.maxWilson !== null,
      count: n,
      run: () => {
        const limit = limits.maxWilson ?? 0;
        // Lower bound for the share of samples slower than t (ADR-0010).
        const { k } = exceedingShare(durations, t ?? 0);
        const actual = wilsonBounds(k, m)?.lower ?? 0;
        return {
          rule: 'wilson',
          n: m,
          actual,
          observed: roundRatio(k / m),
          limit,
          passed: !(actual > limit),
        };
      },
    },
    {
      ...errors,
      hasLimits: true,
      count: bigN,
      run: () => {
        // Lower bound for the error rate errorCount / N (09-REQ-09, 09-D-10).
        const actual = wilsonBounds(stats.errorCount, bigN)?.lower ?? 0;
        return {
          rule: 'errors',
          n: bigN,
          actual,
          observed: roundRatio(stats.errorCount / bigN),
          limit: limits.maxErrorRate,
          passed: !(actual > limits.maxErrorRate),
        };
      },
    },
  ];

  const hardLimitFactor = cfg.gate.hardLimitFactor;
  const checks: Check[] = [];
  let applicable = false;
  for (const input of inputs) {
    if (!input.enabled || !input.hasLimits) continue;
    applicable = true;
    // At least one sample is needed in any case: a rule has nothing to compute without one.
    if (input.count < Math.max(1, input.minSamples)) continue;
    const check = input.run();
    // Hard limit: failed time checks only; the product is not rounded (09-REQ-11, 09-D-02).
    const hardLimitExceeded =
      !check.passed &&
      TIME_RULES.has(check.rule) &&
      hardLimitFactor !== null &&
      check.actual > check.limit * hardLimitFactor;
    checks.push({ ...check, hardLimitExceeded, blocking: false });
  }
  return { checks, applicable };
}
