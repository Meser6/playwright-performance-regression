// RequestTracker (05, chapters 4.2 and 5): turns the network events of one browser context
// during one test into request samples.
import type { BrowserContext, Page, Request, Response } from '@playwright/test';
import type { ResolvedConfig } from '../core/config/index.ts';
import { CONTEXT_CLOSED_FAILURE_TEXT } from '../core/types/index.ts';
import type { Diagnostics, RawRequestSample } from '../core/types/index.ts';
import { errorText } from './diagnostics.ts';
import { shouldTrack } from './filters.ts';
import { computeTiming, partialTiming } from './timing.ts';
import type { RequestTimingInput } from './timing.ts';

export interface CollectorOptions {
  measure: ResolvedConfig['measure'];
  /** performance.now(), injected for tests. */
  now: () => number;
  /** Date.now(), injected for tests; startTime when the browser gives none. */
  wallNow: () => number;
}

/** Where a tracker hands over its samples, so that all trackers of a test share one order. */
export interface SampleSink {
  /** A sample, in the order requests finished (05-REQ-15). */
  finished(sample: RawRequestSample): void;
  /** A PENDING sample; these come after all others (05-REQ-13). */
  pending(sample: RawRequestSample): void;
}

interface InFlight {
  startedAtNode: number;
  startedAtWall: number;
  /** Page that started the request, when known; for closing pages (05-REQ-30). */
  page: Page | null;
  /** Set by the response event (05-REQ-31). */
  response: Response | null;
  /** requestfinished arrived and the sample is being computed. */
  settling: boolean;
}

const NO_TIMING: RequestTimingInput = {
  startTime: -1,
  requestStart: -1,
  responseStart: -1,
  responseEnd: -1,
};

/** Statuses without a response body (05-REQ-33). */
const BODYLESS: ReadonlySet<number> = new Set([204, 205, 304]);

export class RequestTracker {
  readonly context: BrowserContext;
  readonly #opts: CollectorOptions;
  readonly #diag: Diagnostics;
  readonly #sink: SampleSink;
  readonly #inflight = new Map<Request, InFlight>();
  readonly #idle = new Set<() => void>();
  readonly #pages = new Map<Page, () => void>();
  readonly #detachers: (() => void)[] = [];
  #accepting = true;
  #closed = false;
  #detached = false;
  #draining: Promise<void> | undefined;

  constructor(
    context: BrowserContext,
    opts: CollectorOptions,
    diag: Diagnostics,
    sink: SampleSink,
  ) {
    this.context = context;
    this.#opts = opts;
    this.#diag = diag;
    this.#sink = sink;
    this.#listen('request', (request: Request) => this.#onRequest(request));
    this.#listen('response', (response: Response) => this.#onResponse(response));
    this.#listen('requestfinished', (request: Request) => this.#onFinished(request));
    this.#listen('requestfailed', (request: Request) => this.#onFailed(request));
    this.#listen('page', (page: Page) => this.#watchPage(page));
    this.#listen('close', () => this.#onContextClose());
    for (const page of context.pages()) this.#watchPage(page);
  }

  /** The context was closed while the tracker was attached (05-REQ-30). */
  get closed(): boolean {
    return this.#closed;
  }

  /**
   * Stops accepting requests, waits up to budgetMs for requests in flight (not at all when the
   * context is closed), turns the rest into samples per 05-REQ-13 and 05-REQ-31, detaches.
   * Calling it again returns the first drain.
   */
  drain(budgetMs: number): Promise<void> {
    this.#draining ??= this.#drain(budgetMs);
    return this.#draining;
  }

  async #drain(budgetMs: number): Promise<void> {
    this.#accepting = false;
    if (!this.#closed && this.#inflight.size > 0 && budgetMs > 0) await this.#waitIdle(budgetMs);
    for (const [request, entry] of this.#inflight) {
      this.#guard('drain', () => this.#leftover(request, entry));
    }
    this.#inflight.clear();
    this.#detach();
  }

  #listen(event: string, handler: (arg: never) => void): void {
    const listener = (arg: never): void => this.#guard(event, () => handler(arg));
    const target = this.context as unknown as {
      on(event: string, listener: (arg: never) => void): void;
      off(event: string, listener: (arg: never) => void): void;
    };
    target.on(event, listener);
    this.#detachers.push(() => target.off(event, listener));
  }

  /** Every handler is guarded: an exception becomes a diagnostic, never a test failure (05-REQ-19). */
  #guard(event: string, fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.#diag.add({
        code: 'COLLECTOR_LISTENER_ERROR',
        message: `collector: the "${event}" handler failed and the event was skipped: ${errorText(error)}`,
        hint: 'Report this as a bug of the package; the test result is not affected.',
      });
    }
  }

  #onRequest(request: Request): void {
    if (!this.#accepting || this.#detached) return;
    const accepted = shouldTrack(
      {
        url: request.url(),
        resourceType: request.resourceType(),
        isServiceWorker: request.serviceWorker() !== null,
      },
      this.#opts.measure,
    );
    if (!accepted) return;
    this.#inflight.set(request, {
      startedAtNode: this.#opts.now(),
      startedAtWall: this.#opts.wallNow(),
      page: pageOf(request),
      response: null,
      settling: false,
    });
  }

  #onResponse(response: Response): void {
    const entry = this.#inflight.get(response.request());
    if (entry !== undefined) entry.response = response;
  }

  #onFinished(request: Request): void {
    // Requests the tracker did not see start are skipped (05-REQ-25).
    const entry = this.#inflight.get(request);
    if (entry === undefined || entry.settling) return;
    entry.settling = true;
    const finishedAtNode = this.#opts.now();
    if (entry.response !== null) {
      this.#complete(request, entry, entry.response, finishedAtNode);
      return;
    }
    // No response event seen: ask for it, off the event handler (05-REQ-12).
    request.response().then(
      (response) => this.#complete(request, entry, response, finishedAtNode),
      (error: unknown) => this.#timingFailed(request, entry, error),
    );
  }

  #complete(
    request: Request,
    entry: InFlight,
    response: Response | null,
    finishedAtNode: number,
    bodyless = false,
  ): void {
    if (this.#inflight.get(request) !== entry) return;
    try {
      if (response === null) throw new Error('the request finished without a response');
      const raw = request.timing();
      // Without a body the response ends with its headers (05-REQ-33).
      const ended =
        bodyless && raw.responseEnd < 0 ? { ...raw, responseEnd: raw.responseStart } : raw;
      const timing = computeTiming(ended, {
        startedAtNode: entry.startedAtNode,
        finishedAtNode,
      });
      this.#settle(request);
      this.#sink.finished({
        ...base(request),
        status: response.status(),
        ...timing,
        startTime: startTimeOf(timing.startTime, entry),
        fromServiceWorker: response.fromServiceWorker(),
      });
    } catch (error) {
      this.#timingFailed(request, entry, error);
    }
  }

  #timingFailed(request: Request, entry: InFlight, error: unknown): void {
    if (this.#inflight.get(request) !== entry) return;
    this.#settle(request);
    this.#diag.add({
      code: 'COLLECTOR_TIMING_FAILED',
      message: `collector: reading the timing or response of a finished request failed, so its sample was skipped: ${errorText(error)}`,
      hint: 'Report this as a bug of the package; the test result is not affected.',
    });
  }

  #onFailed(request: Request): void {
    const entry = this.#inflight.get(request);
    if (entry === undefined) return;
    // A bodyless response followed by requestfailed is a finished request (05-REQ-33): Chromium
    // of Playwright 1.57 reports net::ERR_ABORTED after a 204 response to fetch.
    if (entry.response !== null && !entry.settling && BODYLESS.has(entry.response.status())) {
      entry.settling = true;
      this.#complete(request, entry, entry.response, this.#opts.now(), true);
      return;
    }
    const text = request.failure()?.errorText ?? '';
    this.#settle(request);
    this.#sink.finished(
      failed(request, entry, text === '' ? 'unknown' : text, safeTiming(request)),
    );
  }

  #watchPage(page: Page): void {
    if (this.#pages.has(page) || this.#detached) return;
    const listener = (): void => this.#guard('close', () => this.#onPageClose(page));
    page.on('close', listener);
    this.#pages.set(page, listener);
  }

  /** Requests of a page closed by the test are aborted by the client (05-REQ-30). */
  #onPageClose(page: Page): void {
    for (const [request, entry] of this.#inflight) {
      if (entry.page === page && !entry.settling) this.#closedByClient(request, entry);
    }
  }

  #onContextClose(): void {
    this.#closed = true;
    for (const [request, entry] of this.#inflight) {
      if (!entry.settling) this.#closedByClient(request, entry);
    }
  }

  #closedByClient(request: Request, entry: InFlight): void {
    this.#settle(request);
    this.#sink.finished(failed(request, entry, CONTEXT_CLOSED_FAILURE_TEXT, safeTiming(request)));
  }

  /** A request still in flight after the wait (05-REQ-13 step 4, 05-REQ-31). */
  #leftover(request: Request, entry: InFlight): void {
    const timing = safeTiming(request);
    const startTime = startTimeOf(Math.round(timing.startTime), entry);
    if (entry.response !== null) {
      this.#sink.finished({
        ...base(request),
        status: entry.response.status(),
        startTime,
        duration: null,
        ...partialTiming(timing),
        timeSource: 'browser',
        fromServiceWorker: entry.response.fromServiceWorker(),
      });
      return;
    }
    this.#sink.pending({
      ...base(request),
      status: 'PENDING',
      startTime,
      duration: null,
      requestStart: null,
      ttfb: null,
      timeSource: 'browser',
      fromServiceWorker: false,
    });
  }

  #settle(request: Request): void {
    this.#inflight.delete(request);
    if (this.#inflight.size > 0) return;
    for (const resolve of this.#idle) resolve();
  }

  #waitIdle(budgetMs: number): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.#idle.delete(done);
        resolve();
      };
      const timer = setTimeout(done, budgetMs);
      this.#idle.add(done);
    });
  }

  #detach(): void {
    if (this.#detached) return;
    this.#detached = true;
    for (const detach of this.#detachers) detach();
    for (const [page, listener] of this.#pages) page.off('close', listener);
    this.#pages.clear();
  }
}

function base(request: Request): Pick<RawRequestSample, 'method' | 'url' | 'resourceType'> {
  return {
    method: request.method().toUpperCase(),
    url: request.url(),
    resourceType: request.resourceType(),
  };
}

function failed(
  request: Request,
  entry: InFlight,
  failureText: string,
  timing: RequestTimingInput,
): RawRequestSample {
  return {
    ...base(request),
    status: 'FAILED',
    failureText,
    startTime: startTimeOf(Math.round(timing.startTime), entry),
    duration: null,
    requestStart: null,
    ttfb: null,
    timeSource: 'browser',
    fromServiceWorker: false,
  };
}

/** The browser's start time, or the worker's clock when the browser gave none. */
function startTimeOf(startTime: number, entry: InFlight): number {
  return Number.isFinite(startTime) && startTime > 0 ? startTime : Math.round(entry.startedAtWall);
}

function safeTiming(request: Request): RequestTimingInput {
  try {
    return request.timing();
  } catch {
    return NO_TIMING;
  }
}

/** The page whose frame started the request; null when Playwright does not know it. */
function pageOf(request: Request): Page | null {
  try {
    return request.frame().page();
  } catch {
    return null;
  }
}
