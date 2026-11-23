// Text of the hints of a key (11-REQ-34, 11-D-12): the run report stores code and params, the
// template builds one sentence. Values are formatted as 11-REQ-19 says; the caller escapes.
import { formatFactor } from '../core/format/violation.ts';
import type { Check, Hint, KeyEvaluation } from '../core/types/index.ts';
import type { LinkKind } from './context.ts';
import {
  formatMs,
  formatPercent,
  formatRatio,
  overPercent,
  truncateMiddle,
  usagePercent,
} from './format.ts';

/** Notes of mutings are shortened to this many characters in a hint (11-REQ-34). */
const NOTE_MAX = 80;

/** Name of a rule in a sentence; `level` is the evaluated percentile, e.g. p95. */
export function ruleLabel(rule: Check['rule'] | string, level: string): string {
  switch (rule) {
    case 'percentile':
      return level;
    case 'apdex':
      return 'Apdex';
    case 'wilson':
      return 'slow share';
    case 'errors':
      return 'error rate';
    default:
      return rule;
  }
}

function num(params: Hint['params'], name: string): number {
  const value = params[name];
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function text(params: Hint['params'], name: string): string {
  return String(params[name] ?? '');
}

/** First letter upper case at the start of a sentence; percentile names (p95) stay as they are. */
function capitalize(label: string): string {
  return /^p\d/u.test(label) ? label : label.charAt(0).toUpperCase() + label.slice(1);
}

/** The sentence of one hint (11-REQ-34); a step is not an HTTP response, so its hints say samples. */
export function hintText(
  hint: Hint,
  level: string,
  muted: KeyEvaluation['muted'],
  kind: LinkKind = 'api',
): string {
  const p = hint.params;
  const responses = kind === 'step' ? 'samples' : 'responses';
  const over = (): string => String(overPercent(num(p, 'usage')));
  const pctMedian = (): string => String(usagePercent(num(p, 'medianUsage')));
  switch (hint.code) {
    case 'HINT_HARD_LIMIT':
      return `${capitalize(ruleLabel(text(p, 'rule'), level))} is ${formatFactor(num(p, 'usage'), num(p, 'factor'))}× its limit, above the hard limit of ${String(num(p, 'factor'))}×: it fails the run regardless of tolerance.`;
    case 'HINT_SLOWDOWN':
      return `The median is ${over()}% over its limit: most ${responses} are slower, not only the tail.`;
    case 'HINT_TAIL':
      return `${level} is ${over()}% over its limit while the median is at ${pctMedian()}% of its limit: a growing tail of slow ${responses}, not a general slowdown.`;
    case 'HINT_SHIFT':
      return `${level} is ${over()}% over its limit and the median is at ${pctMedian()}% of its limit: the whole distribution moved up.`;
    case 'HINT_OUTLIERS':
      return `Only p99 is over its limit (by ${over()}%): a few very slow ${responses}, up to ${formatMs(num(p, 'max'))}; see the slowest samples.`;
    case 'HINT_ERRORS_DOMINANT':
      return `Error rate ${formatPercent(num(p, 'rate'))} is above the limit of ${formatPercent(num(p, 'limit'))}, mostly ${text(p, 'label')} (${String(num(p, 'count'))} of ${String(num(p, 'errors'))} errors).`;
    case 'HINT_ERRORS_MIXED':
      return `Error rate ${formatPercent(num(p, 'rate'))} is above the limit of ${formatPercent(num(p, 'limit'))}; errors are spread over ${text(p, 'label1')} (${String(num(p, 'count1'))}), ${text(p, 'label2')} (${String(num(p, 'count2'))}) and ${text(p, 'label3')} (${String(num(p, 'count3'))}).`;
    case 'HINT_APDEX':
      return `Apdex ${formatRatio(num(p, 'apdex'))} is below the limit of ${formatRatio(num(p, 'limit'))} although the percentiles are within limits: many ${responses} are slower than T = ${formatMs(num(p, 't'))}.`;
    case 'HINT_SLOW_SHARE':
      return `${formatPercent(num(p, 'share'))} of ${responses} are slower than T = ${formatMs(num(p, 't'))} (limit ${formatPercent(num(p, 'limit'))}) although the percentiles are within limits: a slow minority.`;
    case 'HINT_MEDIAN_ONLY':
      return `Only the median was evaluated (n = ${String(num(p, 'n'))}): add repetitions for a reliable verdict.`;
    case 'HINT_MUTED':
      return `Muted until ${muted?.until ?? '?'}: this violation does not fail the run (${truncateMiddle(muted?.note ?? '', NOTE_MAX)}).`;
    case 'HINT_FAILED_TESTS':
      return `${formatPercent(num(p, 'share'))} of the samples come from failed tests: the results may be distorted.`;
    case 'HINT_NEAR_LIMIT':
      return `All checks pass, but ${ruleLabel(text(p, 'rule'), level)} is at ${String(usagePercent(num(p, 'usage')))}% of its limit: the next run may fail.`;
  }
}
