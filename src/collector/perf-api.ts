// The `perf` fixture value (06, chapter 3).
import type { BrowserContext } from '@playwright/test';
import type { CustomTimer } from './custom-timer.ts';

export interface PerfApi {
  /** Measures fn. Returns its result; on exception records outcome 'error' and rethrows. */
  measure<R>(name: string, fn: () => R | Promise<R>): Promise<R>;
  /** Starts a named measurement. */
  start(name: string): void;
  /** Ends a named measurement. Returns its duration in ms, or undefined without a matching start. */
  end(name: string): number | undefined;
  /** Alias of start(), for migration from 'playwright-performance'. */
  sampleStart(name: string): void;
  /** Alias of end(), for migration from 'playwright-performance'. */
  sampleEnd(name: string): number | undefined;
  /** Tracks a browser context created in this test or in a test-scoped fixture, until test end. */
  track(context: BrowserContext): void;
}

/** Fixtures added by withPerfFixtures(). */
export interface PerfFixtures {
  perf: PerfApi;
}

/** A PerfApi over `timer`; the methods are bound, so they also work destructured. */
export function createPerfApi(
  timer: CustomTimer,
  track: (context: BrowserContext) => void,
): PerfApi {
  const start = (name: string): void => timer.start(name);
  const end = (name: string): number | undefined => timer.end(name);
  return Object.freeze({
    measure: <R>(name: string, fn: () => R | Promise<R>): Promise<R> => timer.measure(name, fn),
    start,
    end,
    sampleStart: start,
    sampleEnd: end,
    track,
  });
}
