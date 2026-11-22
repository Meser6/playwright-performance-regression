// The `perf` fixture value (05-REQ-32, 15-REQ-03).
import type { APIRequestContext, BrowserContext } from '@playwright/test';

export interface PerfApi {
  /** Tracks a browser context created in this test or in a test-scoped fixture, until test end. */
  track(context: BrowserContext): void;
  /**
   * Measures the calls of an APIRequestContext from playwright.request.newContext() (15-REQ-03).
   * Does nothing outside perf mode or in projects that are not measured.
   */
  trackRequestContext(requestContext: APIRequestContext): void;
}

/** Fixtures added by withPerfFixtures(). */
export interface PerfFixtures {
  perf: PerfApi;
}

/** A PerfApi over `track` and `trackRequestContext`; the methods are bound, so they also work destructured. */
export function createPerfApi(
  track: (context: BrowserContext) => void,
  trackRequestContext: (requestContext: APIRequestContext) => void = () => {
    // Nothing is measured outside perf mode or in projects that are not measured.
  },
): PerfApi {
  return Object.freeze({ track, trackRequestContext });
}
