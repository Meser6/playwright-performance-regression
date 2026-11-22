// withPerfFixtures() and trackContext() (01, chapter 4.5; 05, chapters 3 and 4).
import type { APIRequestContext, BrowserContext, Page, TestInfo, TestType } from '@playwright/test';
import { perfDefaults } from '../core/config/index.ts';
import { ConfigError } from '../core/types/index.ts';
import { DEFAULT_MAX_TESTS, readModeState } from '../mode/index.ts';
import { checkRunsTest } from './check-skip.ts';
import {
  activeCollector,
  getRegistered,
  setActiveCollector,
  trackedContexts,
  wrappedTests,
} from '../registry/index.ts';
import { isApiRequestContext, wrapRequestContext } from './api-requests.ts';
import { createPerfApi } from './perf-api.ts';
import type { PerfApi, PerfFixtures } from './perf-api.ts';
import { TestCollector } from './test-collector.ts';
import { version } from '../../package.json';

/** `base` with the `perf` fixture added; other fixtures and options keep their types. */
export type PerfTestType<T> =
  T extends TestType<infer TestArgs, infer WorkerArgs>
    ? TestType<TestArgs & PerfFixtures, WorkerArgs>
    : never;

/** Value of the internal `_perfBuffer` fixture: the collector of a measured test, or none. */
interface PerfBuffer {
  collector: TestCollector | null;
  api: PerfApi;
}

const now = (): number => performance.now();
const wallNow = (): number => Date.now();

/** Perf mode from the environment; it is fixed for the life of the worker (05-REQ-01). */
function perfModeOn(): boolean {
  const mode = readModeState(process.env);
  if (!mode.ok) throw new ConfigError(mode.issues);
  return mode.value !== null;
}

/** A perf API whose track() does nothing (05-REQ-32). */
const PASSIVE_API: PerfApi = createPerfApi(() => {
  // Nothing is tracked outside perf mode or in projects that are not measured.
});

/**
 * The buffer of one test (05-REQ-21): a collector in measured projects, otherwise only the
 * passive perf API. With measure.api off there is no collector in any project (03-REQ-28).
 * Without withPerf() in this process the default config is used and every project is measured
 * (01-REQ-07; the reporter reports the missing withPerf()).
 */
function openBuffer(
  browserName: string | null,
  baseURL: string | undefined,
  testInfo: TestInfo,
): PerfBuffer {
  const state = getRegistered();
  if (
    state !== undefined &&
    (!state.config.measure.api || !state.measuredProjects.includes(testInfo.project.name))
  ) {
    return { collector: null, api: PASSIVE_API };
  }
  const collector = new TestCollector({
    measure: (state?.config ?? perfDefaults).measure,
    version,
    browserName,
    testTimeout: () => testInfo.timeout,
    baseURL,
    now,
    wallNow,
  });
  // Worker-scoped contexts registered with trackContext() (05-REQ-23).
  for (const context of trackedContexts()) collector.track(context as BrowserContext);
  return { collector, api: collector.api };
}

/**
 * A check runs the first test of each file of the measured projects, up to PW_PERF_MAX_TESTS;
 * the others are skipped before their body (04-REQ-49). Dependency projects run in full.
 */
function skipInCheck(testInfo: TestInfo): void {
  const state = getRegistered();
  if (state === undefined || state.mode.mode !== 'check') return;
  if (!state.measuredProjects.includes(testInfo.project.name)) return;
  const max = state.mode.maxTests ?? DEFAULT_MAX_TESTS;
  if (!checkRunsTest(state.mode.runId, max, testInfo.project.name, testInfo.file)) {
    testInfo.skip(true, 'PW_PERF_MODE=check: only the first test of each file runs');
  }
}

/* eslint-disable no-empty-pattern -- Playwright reads fixture dependencies from the pattern. */
const passiveFixtures = {
  perf: async ({}, use: (api: PerfApi) => Promise<void>): Promise<void> => {
    await use(PASSIVE_API);
  },
};
/* eslint-enable no-empty-pattern */

const perfFixtures = {
  _perfBuffer: [
    async (
      { browserName, baseURL }: { browserName: string; baseURL: string | undefined },
      use: (buffer: PerfBuffer) => Promise<void>,
      testInfo: TestInfo,
    ): Promise<void> => {
      skipInCheck(testInfo);
      const buffer = openBuffer(browserName ?? null, baseURL, testInfo);
      const { collector } = buffer;
      if (collector !== null) setActiveCollector(collector);
      await use(buffer);
      if (collector === null) return;
      if (activeCollector() === collector) setActiveCollector(undefined);
      collector.markTeardownStart();
      // Drains here only when no page or context override did (05-REQ-13), then attaches the
      // batch, also an empty one (05-REQ-15).
      await collector.attach(testInfo);
    },
    { auto: true, box: true },
  ],
  context: async (
    { context, _perfBuffer }: { context: BrowserContext; _perfBuffer: PerfBuffer },
    use: (context: BrowserContext) => Promise<void>,
  ): Promise<void> => {
    _perfBuffer.collector?.track(context, true);
    await use(context);
    // First teardown of the collector: drain before the base context closes (05-REQ-02, V-09).
    await _perfBuffer.collector?.drain();
  },
  page: async (
    { page, _perfBuffer }: { page: Page; _perfBuffer: PerfBuffer },
    use: (page: Page) => Promise<void>,
  ): Promise<void> => {
    _perfBuffer.collector?.coverPage(page);
    await use(page);
    await _perfBuffer.collector?.drain();
  },
  // The same object with its request methods measured (15-REQ-03); untouched without a collector.
  request: async (
    { request, _perfBuffer }: { request: APIRequestContext; _perfBuffer: PerfBuffer },
    use: (request: APIRequestContext) => Promise<void>,
  ): Promise<void> => {
    _perfBuffer.collector?.wrapRequest(request, 'request');
    await use(request);
  },
  perf: async (
    { _perfBuffer }: { _perfBuffer: PerfBuffer },
    use: (api: PerfApi) => Promise<void>,
  ): Promise<void> => {
    await use(_perfBuffer.api);
    _perfBuffer.collector?.markTeardownStart();
  },
};

/**
 * Adds the collector fixtures to `base` (05, chapter 3). Outside perf mode only the `perf`
 * fixture is added and nothing else changes (05-REQ-01). Wrapping a test object this function
 * returned gives it back unchanged (05-REQ-22). Never imports @playwright/test at runtime: it
 * works with the `base` it gets (01-REQ-15).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withPerfFixtures<T extends TestType<any, any>>(base: T): PerfTestType<T> {
  const wrapped = wrappedTests();
  if (wrapped.has(base)) return base as unknown as PerfTestType<T>;
  const extend = base.extend as (fixtures: object) => PerfTestType<T>;
  const result = extend.call(base, perfModeOn() ? perfFixtures : passiveFixtures);
  wrapped.add(result as object);
  return result;
}

/**
 * Registers a worker-scoped browser context: every test of a measured project tracks it with
 * its own tracker (05-REQ-23). Call it once, right after creating the context. Does nothing
 * outside perf mode.
 */
export function trackContext(context: BrowserContext): void {
  if (!perfModeOn()) return;
  const contexts = trackedContexts();
  if (!contexts.has(context)) {
    contexts.add(context);
    context.once('close', () => contexts.delete(context));
  }
  // Registered during a test (e.g. a worker fixture set up by this test): track it now.
  activeCollector()?.track(context);
}

/**
 * Measures the calls of an APIRequestContext created with playwright.request.newContext(), also
 * in a worker-scoped fixture (15-REQ-03): each call made during a test of a measured project is
 * recorded by that test. Does nothing outside perf mode or with measure.api off.
 */
export function trackRequestContext(requestContext: APIRequestContext): void {
  if (!perfModeOn()) return;
  const state = getRegistered();
  if (state !== undefined && !state.config.measure.api) return;
  if (!isApiRequestContext(requestContext)) {
    activeCollector()?.requestContextNotTracked();
    return;
  }
  wrapRequestContext(requestContext, 'tracked', undefined, activeCollector);
}
