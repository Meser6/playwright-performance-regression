// The collector of one test in a measured project (05, chapter 6): its trackers, diagnostics,
// the single end-of-test drain and the sample batch attachment.
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import type { ResolvedConfig } from '../core/config/index.ts';
import { SAMPLES_ATTACHMENT_NAME } from '../core/types/index.ts';
import type { RawApiRequestSample, RawRequestSample, SampleBatch } from '../core/types/index.ts';
import { activeCollector } from '../registry/index.ts';
import { isApiRequestContext, wrapRequestContext } from './api-requests.ts';
import type { ApiCall, ApiRecorder, ApiSource } from './api-requests.ts';
import { COLLECTOR_NAME, SAMPLE_LIMIT_PER_TEST } from './constants.ts';
import { createDiagnostics, errorText } from './diagnostics.ts';
import { shouldTrackApiCall } from './filters.ts';
import { createPerfApi } from './perf-api.ts';
import type { PerfApi } from './perf-api.ts';
import { RequestTracker } from './request-tracker.ts';
import type { SampleSink } from './request-tracker.ts';
import { pendingBudgetMs, roundMs } from './timing.ts';

export interface TestCollectorOptions {
  measure: ResolvedConfig['measure'];
  /** Package version for collector.version. */
  version: string;
  /** The browserName option of the test, for contexts without a Browser object (05-REQ-29). */
  browserName: string | null;
  /** Current testInfo.timeout (it may change during the test). */
  testTimeout: () => number;
  /** The baseURL option of the test: relative API call URLs resolve against it (15-REQ-05). */
  baseURL?: string | undefined;
  now: () => number;
  wallNow: () => number;
}

/** An APIRequestContext call that has not settled yet (15-REQ-08). */
interface ApiInFlight {
  call: ApiCall;
  source: ApiSource;
  startTime: number;
  settled: Promise<unknown>;
  done: boolean;
}

/** The recorder of the running test, read when a wrapped method is called (15-REQ-03). */
function currentRecorder(): ApiRecorder | undefined {
  return activeCollector();
}

/** First line of an error message; never empty (15-REQ-05). */
function firstLine(error: unknown): string {
  const line = errorText(error).split('\n', 1)[0]?.trim() ?? '';
  return line === '' ? 'unknown' : line;
}

export class TestCollector implements ApiRecorder {
  readonly api: PerfApi;
  readonly #opts: TestCollectorOptions;
  readonly #diag = createDiagnostics();
  readonly #trackers = new Map<BrowserContext, RequestTracker>();
  readonly #requests: RawRequestSample[] = [];
  readonly #pending: RawRequestSample[] = [];
  readonly #apiRequests: RawApiRequestSample[] = [];
  readonly #apiPending: RawApiRequestSample[] = [];
  readonly #apiInFlight = new Set<ApiInFlight>();
  readonly #sink: SampleSink;
  #dropped = 0;
  #browserName: string | null | undefined;
  #autoTracked = false;
  #teardownStart: number | undefined;
  #draining: Promise<void> | undefined;

  constructor(opts: TestCollectorOptions) {
    this.#opts = opts;
    this.api = createPerfApi(
      (context) => {
        this.track(context);
      },
      (requestContext) => {
        this.trackRequestContext(requestContext);
      },
    );
    this.#sink = {
      finished: (sample) => this.#keep(this.#requests, sample),
      pending: (sample) => this.#keep(this.#pending, sample),
    };
  }

  /** The sample limit counts browser samples and API calls together (05-REQ-16, 15-REQ-09). */
  #keep<T>(list: T[], sample: T): void {
    const count =
      this.#requests.length +
      this.#pending.length +
      this.#apiRequests.length +
      this.#apiPending.length;
    if (count < SAMPLE_LIMIT_PER_TEST) list.push(sample);
    else this.#dropped += 1;
  }

  /**
   * Wraps an APIRequestContext of this test (15-REQ-03): the request fixture or context.request.
   * Relative URLs resolve against the test's baseURL only for the request fixture and the context
   * of the context fixture, which Playwright creates with that baseURL; any other context may have
   * its own baseURL, so its calls take response.url() (15-REQ-05).
   */
  wrapRequest(requestContext: object, source: ApiSource, testBaseURL = source === 'request'): void {
    try {
      wrapRequestContext(
        requestContext,
        source,
        testBaseURL ? this.#opts.baseURL : undefined,
        currentRecorder,
      );
    } catch (error) {
      this.#diag.add({
        code: 'COLLECTOR_LISTENER_ERROR',
        message: `collector: wrapping an APIRequestContext failed, so its calls are not measured: ${errorText(error)}`,
        hint: 'Report this as a bug of the package; the test result is not affected.',
      });
    }
  }

  /** perf.trackRequestContext() (15-REQ-03, 15-AC-07). */
  trackRequestContext(requestContext: unknown): void {
    if (!isApiRequestContext(requestContext)) {
      this.requestContextNotTracked();
      return;
    }
    this.wrapRequest(requestContext as object, 'tracked');
  }

  requestContextNotTracked(): void {
    this.#diag.add({
      code: 'COLLECTOR_REQUEST_CONTEXT_NOT_TRACKED',
      message:
        'collector: trackRequestContext() got an object that is not an APIRequestContext, so it is not measured',
      hint: 'Pass the object returned by playwright.request.newContext().',
    });
  }

  /**
   * Records one APIRequestContext call (15-REQ-05): the returned promise settles like `result`
   * (same value, same error); the sample is made when it settles or at the end-of-test wait.
   */
  observeApiCall(call: ApiCall, source: ApiSource, result: Promise<unknown>): Promise<unknown> {
    if (this.#draining !== undefined) return result;
    const startedAt = this.#opts.now();
    const entry: ApiInFlight = {
      call,
      source,
      startTime: Math.round(this.#opts.wallNow()),
      settled: Promise.resolve(),
      done: false,
    };
    const finish = (
      status: RawApiRequestSample['status'],
      extra: Partial<RawApiRequestSample>,
      responseUrl?: string,
    ): void => {
      try {
        if (entry.done) return;
        entry.done = true;
        this.#apiInFlight.delete(entry);
        const sample = this.#apiSample(entry, status, responseUrl, extra);
        if (sample !== null) this.#keep(this.#apiRequests, sample);
      } catch (error) {
        this.#diag.add({
          code: 'COLLECTOR_LISTENER_ERROR',
          message: `collector: recording an APIRequestContext call failed: ${errorText(error)}`,
          hint: 'Report this as a bug of the package; the test result is not affected.',
        });
      }
    };
    const out = result.then(
      (response) => {
        const duration = roundMs(this.#opts.now() - startedAt);
        let status: number | undefined;
        let url: string | undefined;
        try {
          const r = response as { status?: () => unknown; url?: () => unknown };
          const s = typeof r.status === 'function' ? r.status() : undefined;
          status =
            typeof s === 'number' && Number.isInteger(s) && s >= 100 && s <= 599 ? s : undefined;
          const u = typeof r.url === 'function' ? r.url() : undefined;
          url = typeof u === 'string' && u !== '' ? u : undefined;
        } catch {
          status = undefined;
        }
        if (status === undefined) finish('FAILED', { failureText: 'unknown', duration: null }, url);
        else finish(status, { duration }, url);
        return response;
      },
      (error: unknown) => {
        finish('FAILED', { failureText: firstLine(error), duration: null });
        throw error;
      },
    );
    entry.settled = out.then(
      () => undefined,
      () => undefined,
    );
    this.#apiInFlight.add(entry);
    return out;
  }

  /** The sample of a call, or null when the filters skip its URL (15-REQ-06). */
  #apiSample(
    entry: ApiInFlight,
    status: RawApiRequestSample['status'],
    responseUrl: string | undefined,
    extra: Partial<RawApiRequestSample>,
  ): RawApiRequestSample | null {
    const url = entry.call.url ?? responseUrl ?? entry.call.rawUrl;
    if (url === '' || !shouldTrackApiCall(url, this.#opts.measure)) return null;
    return {
      method: entry.call.method,
      url,
      status,
      ...(status === 'FAILED' ? { failureText: extra.failureText ?? 'unknown' } : {}),
      startTime: entry.startTime,
      duration: extra.duration ?? null,
      source: entry.source,
    };
  }

  /**
   * Attaches a tracker to `context` unless it already has one in this test (05-REQ-04) or the
   * test is draining. Returns true when a tracker was attached. `contextFixture`: the context of
   * the context fixture, whose request calls resolve against the test's baseURL (15-REQ-05).
   */
  track(context: BrowserContext, contextFixture = false): boolean {
    if (this.#draining !== undefined || this.#trackers.has(context)) return false;
    // page.request is context.request: one wrapper for both (15-REQ-03, 15-REQ-04).
    let requestContext: unknown;
    try {
      requestContext = (context as { request?: unknown }).request;
    } catch {
      requestContext = undefined;
    }
    // A context without request (e.g. a test double) is measured without API calls.
    if (typeof requestContext === 'object' && requestContext !== null) {
      this.wrapRequest(requestContext, 'context', contextFixture);
    }
    try {
      this.#trackers.set(
        context,
        new RequestTracker(
          context,
          { measure: this.#opts.measure, now: this.#opts.now, wallNow: this.#opts.wallNow },
          this.#diag,
          this.#sink,
        ),
      );
    } catch (error) {
      this.#diag.add({
        code: 'COLLECTOR_LISTENER_ERROR',
        message: `collector: attaching to a browser context failed, so it is not measured: ${errorText(error)}`,
        hint: 'Report this as a bug of the package; the test result is not affected.',
      });
      return false;
    }
    this.#browserName ??= engineOf(context) ?? this.#opts.browserName;
    return true;
  }

  /** The page override: tracks the page's context when nothing else did (05-REQ-14). */
  coverPage(page: Page): void {
    let context: BrowserContext;
    try {
      context = page.context();
    } catch {
      return;
    }
    if (!this.track(context) || this.#autoTracked) return;
    this.#autoTracked = true;
    this.#diag.add({
      code: 'COLLECTOR_CONTEXT_AUTO_TRACKED',
      message:
        'collector: the context of the "page" fixture was not tracked by the "context" fixture, so the page override tracks it',
      hint: 'Measurement works. To track it directly, apply withPerfFixtures() last in the extend chain and build custom "context" fixtures on the base "context".',
    });
  }

  /** Start of the teardown phase: the first collector fixture whose use() returned (05-REQ-27). */
  markTeardownStart(): void {
    this.#teardownStart ??= this.#opts.now();
  }

  /** Drains all trackers once per test with one shared budget (05-REQ-13). */
  drain(): Promise<void> {
    this.#draining ??= this.#drain();
    return this.#draining;
  }

  async #drain(): Promise<void> {
    this.markTeardownStart();
    const budget = pendingBudgetMs({
      pendingTimeoutMs: this.#opts.measure.pendingTimeoutMs,
      testTimeoutMs: this.#opts.testTimeout(),
      sinceTeardownStartMs: this.#opts.now() - (this.#teardownStart ?? this.#opts.now()),
    });
    await Promise.all([
      this.#drainApiCalls(budget),
      ...[...this.#trackers.values()].map(async (tracker) => {
        try {
          await tracker.drain(budget);
        } catch (error) {
          this.#diag.add({
            code: 'COLLECTOR_LISTENER_ERROR',
            message: `collector: draining a browser context failed: ${errorText(error)}`,
            hint: 'Report this as a bug of the package; the test result is not affected.',
          });
        }
      }),
    ]);
  }

  /** Waits for running API calls within the budget; the rest become PENDING (15-REQ-08). */
  async #drainApiCalls(budget: number): Promise<void> {
    if (this.#apiInFlight.size > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, budget));
      });
      await Promise.race([
        Promise.all([...this.#apiInFlight].map((entry) => entry.settled)),
        timeout,
      ]);
      clearTimeout(timer);
    }
    for (const entry of [...this.#apiInFlight]) {
      entry.done = true;
      this.#apiInFlight.delete(entry);
      try {
        const sample = this.#apiSample(entry, 'PENDING', undefined, { duration: null });
        if (sample !== null) this.#keep(this.#apiPending, sample);
      } catch (error) {
        this.#diag.add({
          code: 'COLLECTOR_LISTENER_ERROR',
          message: `collector: recording an APIRequestContext call failed: ${errorText(error)}`,
          hint: 'Report this as a bug of the package; the test result is not affected.',
        });
      }
    }
  }

  /** The sample batch of the test (05-REQ-15); call after drain(). */
  batch(): SampleBatch {
    if (this.#dropped > 0) {
      this.#diag.add({
        code: 'COLLECTOR_SAMPLE_LIMIT_REACHED',
        message: `collector: the test made more than ${SAMPLE_LIMIT_PER_TEST} measured requests; ${this.#dropped} samples were dropped`,
        hint: 'Split the test, or skip requests that do not need measuring with measure.exclude.',
        count: this.#dropped,
      });
      this.#dropped = 0;
    }
    return {
      schemaVersion: 3,
      collector: {
        name: COLLECTOR_NAME,
        version: this.#opts.version,
        browserName: this.#browserName ?? null,
      },
      requests: [...this.#requests, ...this.#pending],
      apiRequests: [...this.#apiRequests, ...this.#apiPending],
      diagnostics: this.#diag.list(),
    };
  }

  /** Drains and writes the attachment; never throws (05-REQ-20). */
  async attach(testInfo: Pick<TestInfo, 'attach'>): Promise<void> {
    try {
      await this.drain();
      const body = JSON.stringify(this.batch());
      await testInfo.attach(SAMPLES_ATTACHMENT_NAME, { body, contentType: 'application/json' });
    } catch (error) {
      process.stderr.write(
        `COLLECTOR_ATTACH_FAILED: ${SAMPLES_ATTACHMENT_NAME} could not be attached to the test result: ${errorText(error)}\n`,
      );
    }
  }
}

/** Engine name of the context's browser; null for contexts without one (05-REQ-29). */
function engineOf(context: BrowserContext): string | null {
  try {
    return context.browser()?.browserType().name() ?? null;
  } catch {
    return null;
  }
}
