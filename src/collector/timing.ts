// Timing computation (05, chapter 5.4) and the end-of-test wait budget (05-REQ-27). Pure.
import type { RawRequestSample } from '../core/types/index.ts';
import { PENDING_RESERVE_MS } from './constants.ts';

/** Durations in ms, rounded to 0.1 ms (02-REQ-07). */
export function roundMs(x: number): number {
  return Math.round(x * 10) / 10 + 0;
}

/** Request.timing() values: ms relative to startTime, -1 when not available. */
export interface RequestTimingInput {
  startTime: number;
  requestStart: number;
  responseStart: number;
  responseEnd: number;
}

/** performance.now() in the worker when the request and requestfinished events arrived. */
export interface NodeFallback {
  startedAtNode: number;
  finishedAtNode: number;
}

export type ComputedTiming = Pick<
  RawRequestSample,
  'startTime' | 'duration' | 'requestStart' | 'ttfb' | 'timeSource'
>;

/** requestStart and ttfb of a timing (05, chapter 5.4); null when the browser did not report them. */
export function partialTiming(
  timing: RequestTimingInput,
): Pick<RawRequestSample, 'requestStart' | 'ttfb'> {
  const { requestStart, responseStart } = timing;
  const ttfb = responseStart - requestStart;
  return {
    requestStart: requestStart >= 0 ? roundMs(requestStart) : null,
    ttfb: requestStart >= 0 && responseStart >= 0 && ttfb >= 0 ? roundMs(ttfb) : null,
  };
}

/**
 * Sample timing of a finished request (05, chapter 5.4). duration is timing.responseEnd; when
 * the browser did not report it, the worker's clock is the fallback with timeSource 'node'
 * (05-REQ-10).
 */
export function computeTiming(timing: RequestTimingInput, fallback: NodeFallback): ComputedTiming {
  const browser = timing.responseEnd >= 0;
  return {
    startTime: Math.round(timing.startTime),
    duration: roundMs(
      browser ? timing.responseEnd : Math.max(0, fallback.finishedAtNode - fallback.startedAtNode),
    ),
    ...partialTiming(timing),
    timeSource: browser ? 'browser' : 'node',
  };
}

/**
 * How long the collector waits for requests in flight at test end (05-REQ-27):
 * min(pendingTimeoutMs, testTimeoutMs - sinceTeardownStartMs - PENDING_RESERVE_MS), at least
 * 0. testTimeoutMs 0 means no test timeout: only pendingTimeoutMs counts.
 */
export function pendingBudgetMs(input: {
  pendingTimeoutMs: number;
  testTimeoutMs: number;
  sinceTeardownStartMs: number;
}): number {
  const { pendingTimeoutMs, testTimeoutMs, sinceTeardownStartMs } = input;
  if (testTimeoutMs === 0) return Math.max(0, pendingTimeoutMs);
  const left = testTimeoutMs - sinceTeardownStartMs - PENDING_RESERVE_MS;
  return Math.max(0, Math.min(pendingTimeoutMs, left));
}
