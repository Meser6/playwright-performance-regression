// Constants shared by the collector and the core (P-13).

/**
 * failureText of requests still in flight when the test closed their page or context
 * (05-REQ-30). Defined here so the collector (which may not import core/stats) and the
 * classification in core/stats (08-REQ-05) use one value.
 */
export const CONTEXT_CLOSED_FAILURE_TEXT = 'pw-perf: context closed';
