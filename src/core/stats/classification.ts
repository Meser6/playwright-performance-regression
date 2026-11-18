// Classification of samples: status labels, successful and error samples (08, chapter 3).
import type { RawRequestSample } from '../types/index.ts';
import { CONTEXT_CLOSED_FAILURE_TEXT } from '../types/index.ts';

/**
 * failureText values of requests cancelled by the browser, per engine, plus the collector's
 * context-closed text (08-REQ-05, 08-D-15, P-13). "Blocked by Web Inspector" is deliberately
 * absent: WebKit uses it for every route.abort(), so it does not tell an abort from a failure.
 */
export const ABORT_FAILURE_TEXTS: readonly string[] = Object.freeze([
  'net::ERR_ABORTED',
  'NS_BINDING_ABORTED',
  'NS_ERROR_ABORT',
  'cancelled',
  CONTEXT_CLOSED_FAILURE_TEXT,
]);

const ABORT_TEXTS = new Set(ABORT_FAILURE_TEXTS);

/**
 * Status label of a request sample (08-REQ-05): the HTTP code as text, ABORTED for FAILED with
 * an abort text, FAILED for other failures, PENDING.
 */
export function requestStatusLabel(
  sample: Pick<RawRequestSample, 'status'> & { failureText?: string | undefined },
): string {
  const { status } = sample;
  if (typeof status === 'number') return String(status);
  if (
    status === 'FAILED' &&
    sample.failureText !== undefined &&
    ABORT_TEXTS.has(sample.failureText)
  ) {
    return 'ABORTED';
  }
  return status;
}

const STATUS_CLASS = /^([1-9])xx$/u;
const HTTP_CODE = /^[1-9]\d\d$/u;

/**
 * Matcher of status labels against a list of status patterns (measure.successStatuses,
 * checks.errors.statuses): a class such as "5xx" matches every three-digit HTTP code starting
 * with that digit; anything else (an exact code, FAILED, ABORTED, PENDING) matches only itself.
 */
export function compileStatusMatcher(patterns: readonly string[]): (label: string) => boolean {
  const classes = new Set<string>();
  const exact = new Set<string>();
  for (const pattern of patterns) {
    const match = STATUS_CLASS.exec(pattern);
    if (match?.[1] !== undefined) classes.add(match[1]);
    else exact.add(pattern);
  }
  return (label) => exact.has(label) || (HTTP_CODE.test(label) && classes.has(label.charAt(0)));
}
