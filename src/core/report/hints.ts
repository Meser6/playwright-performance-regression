// Headroom to the limits (check.usage, 11-REQ-30, 11-D-11) and rule-based hints of a key
// (11-REQ-34, 11-D-12). Both are part of the run report, so the HTML report and any later
// consumer show the same values; the text of a hint is built by the HTML template.
import { roundRatio } from '../format/index.ts';
import { compileStatusMatcher } from '../stats/index.ts';
import type { Check, EvaluatedCheck, Hint, KeyEvaluation } from '../types/index.ts';

/** A hint below the key's headroom of this value is not "near the limit" (11-REQ-34). */
export const NEAR_LIMIT_USAGE = 0.9;
/** Median usage up to which a failed percentile is a growing tail, not a shift (11-REQ-34). */
export const TAIL_MEDIAN_USAGE = 0.8;
/** Hints stored per key (02-REQ-30). */
export const MAX_HINTS = 3;

/**
 * Part of the limit a check uses (11-REQ-30), rounded to 4 decimal places: actual / limit, and
 * (1 − actual) / (1 − limit) for apdex, where a larger value is better. A limit that leaves no
 * headroom gives 0 when the value is at it, otherwise null.
 */
export function checkUsage(check: Pick<Check, 'rule' | 'actual' | 'limit'>): number | null {
  if (check.rule === 'apdex') {
    if (check.limit === 1) return check.actual === 1 ? 0 : null;
    return roundRatio((1 - check.actual) / (1 - check.limit));
  }
  if (check.limit === 0) return check.actual === 0 ? 0 : null;
  return roundRatio(check.actual / check.limit);
}

/** Adds `usage` to every check of an evaluation (11-REQ-30). */
export function withUsage(checks: readonly EvaluatedCheck[]): Check[] {
  return checks.map((check) => ({ ...check, usage: checkUsage(check) }));
}

/**
 * Headroom of a key: the largest usage of its checks, null counting as infinity; null for a key
 * without checks (11-REQ-30).
 */
export function keyHeadroom(checks: readonly Pick<Check, 'usage'>[]): number | null {
  if (checks.length === 0) return null;
  let max = -Infinity;
  for (const check of checks) max = Math.max(max, check.usage ?? Infinity);
  return max;
}

/** The facts of a key the hint rules read. */
export interface HintFacts {
  count: number;
  errorCount: number;
  fromFailedTests: number;
  statuses: Readonly<Record<string, number>>;
  stats: { max: number } | null;
  evaluation: Pick<KeyEvaluation, 'result' | 'limits' | 'muted'> & { checks: Check[] };
}

export interface HintOptions {
  /** checks.errors.statuses (08-REQ-30). */
  errorStatuses: readonly string[];
  /** gate.hardLimitFactor (09-REQ-11); null disables hard limits. */
  hardLimitFactor: number | null;
}

const TIME_RULES: readonly Check['rule'][] = ['median', 'percentile', 'p99'];
/** Rule order of the checks, for ties of the near-limit hint (11-REQ-34). */
const RULE_ORDER: readonly Check['rule'][] = [
  'median',
  'percentile',
  'p99',
  'apdex',
  'wilson',
  'errors',
];

/** Code unit order, never localeCompare (02-REQ-04). */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

type Rule = (facts: HintFacts, options: HintOptions) => Hint | null;

function finding(checks: readonly Check[], rule: Check['rule']): Check | undefined {
  return checks.find((c) => c.rule === rule);
}

/** Every executed time check passed (median, percentile, p99). */
function timeChecksPass(checks: readonly Check[]): boolean {
  return checks.every((c) => !TIME_RULES.includes(c.rule) || c.passed);
}

/** Error labels of the key with their counts, largest count first, then by label. */
function errorLabels(facts: HintFacts, options: HintOptions): [string, number][] {
  const isError = compileStatusMatcher(options.errorStatuses);
  return Object.entries(facts.statuses)
    .filter(([label]) => isError(label))
    .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]));
}

/** A failed percentile check with a passed median, split by the median usage. */
function percentileHint(code: 'HINT_TAIL' | 'HINT_SHIFT'): Rule {
  return ({ evaluation: { checks } }) => {
    const percentile = finding(checks, 'percentile');
    const median = finding(checks, 'median');
    if (percentile === undefined || percentile.passed || percentile.usage === null) return null;
    if (median === undefined || !median.passed || median.usage === null) return null;
    const tail = median.usage <= TAIL_MEDIAN_USAGE;
    if (tail !== (code === 'HINT_TAIL')) return null;
    return { code, params: { usage: percentile.usage, medianUsage: median.usage } };
  };
}

/** The rules of 11-REQ-34 in priority order. */
const RULES: readonly Rule[] = [
  ({ evaluation: { checks } }, { hardLimitFactor }) => {
    if (hardLimitFactor === null) return null;
    for (const rule of TIME_RULES) {
      const check = finding(checks, rule);
      if (check?.hardLimitExceeded === true && check.blocking && check.usage !== null) {
        return {
          code: 'HINT_HARD_LIMIT',
          params: { rule, usage: check.usage, factor: hardLimitFactor },
        };
      }
    }
    return null;
  },
  ({ evaluation: { checks } }) => {
    const median = finding(checks, 'median');
    if (median === undefined || median.passed || median.usage === null) return null;
    return { code: 'HINT_SLOWDOWN', params: { usage: median.usage } };
  },
  percentileHint('HINT_TAIL'),
  percentileHint('HINT_SHIFT'),
  ({ stats, evaluation: { checks } }) => {
    const p99 = finding(checks, 'p99');
    const percentile = finding(checks, 'percentile');
    if (p99 === undefined || p99.passed || p99.usage === null || stats === null) return null;
    if (percentile === undefined || !percentile.passed) return null;
    return { code: 'HINT_OUTLIERS', params: { usage: p99.usage, max: stats.max } };
  },
  (facts, options) => {
    const errors = finding(facts.evaluation.checks, 'errors');
    if (errors === undefined || errors.passed || errors.observed === null) return null;
    const [top] = errorLabels(facts, options);
    if (top === undefined || top[1] * 2 < facts.errorCount) return null;
    return {
      code: 'HINT_ERRORS_DOMINANT',
      params: {
        rate: errors.observed,
        limit: errors.limit,
        label: top[0],
        count: top[1],
        errors: facts.errorCount,
      },
    };
  },
  (facts, options) => {
    const errors = finding(facts.evaluation.checks, 'errors');
    if (errors === undefined || errors.passed || errors.observed === null) return null;
    const labels = errorLabels(facts, options);
    const [first, second, third] = labels;
    if (first === undefined || second === undefined || third === undefined) return null;
    if (first[1] * 2 >= facts.errorCount) return null;
    return {
      code: 'HINT_ERRORS_MIXED',
      params: {
        rate: errors.observed,
        limit: errors.limit,
        label1: first[0],
        count1: first[1],
        label2: second[0],
        count2: second[1],
        label3: third[0],
        count3: third[1],
      },
    };
  },
  ({ evaluation: { checks, limits } }) => {
    const apdex = finding(checks, 'apdex');
    if (apdex === undefined || apdex.passed || apdex.observed === null || limits.t === null) {
      return null;
    }
    if (!timeChecksPass(checks)) return null;
    return {
      code: 'HINT_APDEX',
      params: { apdex: apdex.observed, limit: apdex.limit, t: limits.t },
    };
  },
  ({ evaluation: { checks, limits } }) => {
    const wilson = finding(checks, 'wilson');
    if (wilson === undefined || wilson.passed || wilson.observed === null || limits.t === null) {
      return null;
    }
    if (!timeChecksPass(checks)) return null;
    return {
      code: 'HINT_SLOW_SHARE',
      params: { share: wilson.observed, limit: wilson.limit, t: limits.t },
    };
  },
  ({ evaluation: { result, checks } }) => {
    const median = finding(checks, 'median');
    if (result !== 'fail' || median === undefined || finding(checks, 'percentile') !== undefined) {
      return null;
    }
    return { code: 'HINT_MEDIAN_ONLY', params: { n: median.n } };
  },
  ({ evaluation: { result, muted } }) =>
    result === 'fail' && muted !== null && !muted.expired
      ? { code: 'HINT_MUTED', params: {} }
      : null,
  ({ count, fromFailedTests }) =>
    count > 0 && fromFailedTests * 2 >= count
      ? { code: 'HINT_FAILED_TESTS', params: { share: roundRatio(fromFailedTests / count) } }
      : null,
  ({ evaluation: { result, checks } }) => {
    if (result !== 'pass') return null;
    const headroom = keyHeadroom(checks);
    if (headroom === null || headroom === Infinity || headroom < NEAR_LIMIT_USAGE) return null;
    const ordered = [...checks].sort(
      (a, b) => RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule),
    );
    const top = ordered.find((c) => c.usage === headroom);
    if (top === undefined || top.usage === null) return null;
    return { code: 'HINT_NEAR_LIMIT', params: { rule: top.rule, usage: top.usage } };
  },
];

/** The first 3 hints whose rule matches, in the order of 11-REQ-34. */
export function keyHints(facts: HintFacts, options: HintOptions): Hint[] {
  const hints: Hint[] = [];
  for (const rule of RULES) {
    const hint = rule(facts, options);
    if (hint !== null) hints.push(hint);
    if (hints.length === MAX_HINTS) break;
  }
  return hints;
}
