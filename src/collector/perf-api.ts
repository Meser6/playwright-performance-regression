// The `perf` fixture value (05-REQ-32).
import type { BrowserContext } from '@playwright/test';

export interface PerfApi {
  /** Tracks a browser context created in this test or in a test-scoped fixture, until test end. */
  track(context: BrowserContext): void;
}

/** Fixtures added by withPerfFixtures(). */
export interface PerfFixtures {
  perf: PerfApi;
}

/** A PerfApi over `track`; the method is bound, so it also works destructured. */
export function createPerfApi(track: (context: BrowserContext) => void): PerfApi {
  return Object.freeze({ track });
}
