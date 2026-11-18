// The collector of one test in a measured project (05, chapter 6): its trackers, custom
// timer, diagnostics, the single end-of-test drain and the sample batch attachment.
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import type { ResolvedConfig } from '../core/config/index.ts';
import { SAMPLES_ATTACHMENT_NAME } from '../core/types/index.ts';
import type { RawRequestSample, SampleBatch } from '../core/types/index.ts';
import { COLLECTOR_NAME, SAMPLE_LIMIT_PER_TEST } from './constants.ts';
import { CustomTimer } from './custom-timer.ts';
import { createDiagnostics, errorText } from './diagnostics.ts';
import { createPerfApi } from './perf-api.ts';
import type { PerfApi } from './perf-api.ts';
import { RequestTracker } from './request-tracker.ts';
import type { SampleSink } from './request-tracker.ts';
import { pendingBudgetMs } from './timing.ts';

export interface TestCollectorOptions {
  measure: ResolvedConfig['measure'];
  /** Package version for collector.version. */
  version: string;
  /** The browserName option of the test, for contexts without a Browser object (05-REQ-29). */
  browserName: string | null;
  /** Current testInfo.timeout (it may change during the test). */
  testTimeout: () => number;
  now: () => number;
  wallNow: () => number;
}

export class TestCollector {
  readonly api: PerfApi;
  readonly #opts: TestCollectorOptions;
  readonly #diag = createDiagnostics();
  readonly #timer: CustomTimer;
  readonly #trackers = new Map<BrowserContext, RequestTracker>();
  readonly #requests: RawRequestSample[] = [];
  readonly #pending: RawRequestSample[] = [];
  readonly #sink: SampleSink;
  #dropped = 0;
  #browserName: string | null | undefined;
  #autoTracked = false;
  #teardownStart: number | undefined;
  #draining: Promise<void> | undefined;

  constructor(opts: TestCollectorOptions) {
    this.#opts = opts;
    this.#timer = new CustomTimer(
      { now: opts.now, wallNow: opts.wallNow, record: true },
      this.#diag,
    );
    this.api = createPerfApi(this.#timer, (context) => {
      this.track(context);
    });
    const keep = (list: RawRequestSample[], sample: RawRequestSample): void => {
      if (this.#requests.length + this.#pending.length < SAMPLE_LIMIT_PER_TEST) list.push(sample);
      else this.#dropped += 1;
    };
    this.#sink = {
      finished: (sample) => keep(this.#requests, sample),
      pending: (sample) => keep(this.#pending, sample),
    };
  }

  /**
   * Attaches a tracker to `context` unless it already has one in this test (05-REQ-04) or the
   * test is draining. Returns true when a tracker was attached.
   */
  track(context: BrowserContext): boolean {
    if (this.#draining !== undefined || this.#trackers.has(context)) return false;
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
    await Promise.all(
      [...this.#trackers.values()].map(async (tracker) => {
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
    );
  }

  /** The sample batch of the test (05-REQ-15); call after drain(). */
  batch(): SampleBatch {
    const custom = this.#timer.finish();
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
      schemaVersion: 1,
      collector: {
        name: COLLECTOR_NAME,
        version: this.#opts.version,
        browserName: this.#browserName ?? null,
      },
      requests: [...this.#requests, ...this.#pending],
      custom,
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
