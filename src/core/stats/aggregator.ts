// Aggregator: turns enriched samples into per-key aggregates (08).
import { roundMs } from '../format/index.ts';
import type { KeyResult, KeySample } from '../normalize/index.ts';
import { hash53 } from '../random/index.ts';
import type { ResolvedConfig } from '../config/index.ts';
import { COLD_WARN_RATIO, REQUEST_KEY_PREFIX } from '../types/index.ts';
import type {
  AggregateStats,
  Issue,
  RawApiRequestSample,
  RunReport,
  SlowSample,
  StepAggregateStats,
} from '../types/index.ts';
import { compileStatusMatcher, requestStatusLabel } from './classification.ts';
import { sampleId } from './identity.ts';
import type {
  EnrichedRequestSample,
  EnrichedStepSample,
  SampleKind,
  TestMeta,
} from './identity.ts';
import { histogram } from './histogram.ts';
import { percentile, percentileNames } from './percentile.ts';
import { BottomK } from './sampling.ts';
import { TestBreakdownBuilder } from './test-breakdown.ts';
import type { TestBreakdownStats } from './test-breakdown.ts';

export interface AggregatorOptions {
  advanced: ResolvedConfig['advanced'];
  successStatuses: ResolvedConfig['measure']['successStatuses'];
  /** Statuses counted as errors (08-REQ-30). */
  errors: Pick<ResolvedConfig['checks']['errors'], 'statuses'>;
  /** Names of the projects with role 'measured' (08-REQ-31). */
  measuredProjects: ReadonlySet<string>;
  /**
   * Projects that are only dependencies or teardowns of other projects: their samples are left out
   * without the warning (08-REQ-31, F2 decision 34). Default: none.
   */
  dependencyProjects?: ReadonlySet<string>;
  /** checks.time.percentile.level (08-REQ-10). */
  evaluatedPercentile: string;
  /** report.rawUrls: slowest[].url of endpoints (08-REQ-18). */
  rawUrls: boolean;
  /** measure.coldSamples (08-REQ-41); default 0: no cold samples. */
  coldSamples?: number;
  /** checks.time.median.minSamples, for the exclusion of cold samples (08-REQ-42); default 5. */
  minSamples?: number;
}

export type StatsIssueCode =
  | 'STATS_SAMPLES_WITHOUT_BROWSER_TIMING'
  | 'STATS_SAMPLES_OUTSIDE_MEASURED_PROJECTS'
  | 'STATS_MULTIPLE_BROWSERS'
  | 'STATS_COLD_SLOW';

export type StatsIssue = Issue & { code: StatsIssueCode };

export interface Aggregates {
  endpoints: Record<string, AggregateStats>;
  /** test.step keys (06, 08-REQ-40); empty when measure.steps is off. */
  steps: Record<string, StepAggregateStats>;
  /** Request count per known origin, sorted by origin (08-REQ-33). */
  origins: RunReport['origins'];
  /** Run-level STATS_* warnings, each at most once, in catalog order (08, chapter 13). */
  issues: StatsIssue[];
  /**
   * Per-test costs and waterfalls (08-REQ-37, 08-REQ-38); tests carry the full sorted key list
   * instead of violatedKeys, which buildRunReport adds from the evaluation.
   */
  testBreakdown: TestBreakdownStats;
}

/** Number of slowest samples and top tests per key (08-REQ-18, 08-REQ-33). */
const SLOWEST = 3;
const TOP_TESTS = 5;
/** Cold durations kept per key and statuses in failedTimings (08-REQ-43, 08-REQ-47). */
const COLD_KEPT = 5;
const FAILED_STATUSES = 5;
/** STATS_COLD_SLOW: the smallest gap in ms between cold max and warm p50 (08-REQ-44). */
const COLD_WARN_GAP_MS = 100;
/** Keys named in STATS_COLD_SLOW (08-REQ-44). */
const COLD_WARN_KEYS = 3;

/** Code unit order, never localeCompare (02-REQ-04). */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Durations are kept as whole tenths of a millisecond (08-REQ-25). */
function toTenths(ms: number): number {
  return Math.round(ms * 10);
}

interface SlowCandidate {
  tenths: number;
  startedAt: number;
  test: TestMeta;
  ordinal: number;
  sampleId: string;
  url?: string;
}

/**
 * Total order of the slowest samples: duration descending, then file, line, repeatEachIndex
 * (02-REQ-20), ordinal (08-REQ-18) and finally the sampleId, which is unique in the run.
 */
function compareSlow(a: SlowCandidate, b: SlowCandidate): number {
  return (
    b.tenths - a.tenths ||
    compareText(a.test.file, b.test.file) ||
    a.test.line - b.test.line ||
    a.test.repeatEachIndex - b.test.repeatEachIndex ||
    a.ordinal - b.ordinal ||
    compareText(a.sampleId, b.sampleId)
  );
}

interface TestCounter {
  title: string;
  project: string;
  file: string;
  line: number;
  sampleCount: number;
}

type TopTest = AggregateStats['topTests'][number];

function compareTopTests(a: TopTest, b: TopTest): number {
  return (
    b.sampleCount - a.sampleCount ||
    compareText(a.file, b.file) ||
    a.line - b.line ||
    compareText(a.title, b.title) ||
    compareText(a.project, b.project)
  );
}

interface TimedSample {
  test: TestMeta;
  ordinal: number;
  time: { duration: number; ttfb: number | null; startedAt: number; url?: string };
}

class KeyState {
  readonly kind: SampleKind;
  count = 0;
  successCount = 0;
  /** Timed samples seen, cold ones included (08-REQ-41). */
  timed = 0;
  /** The first measure.coldSamples timed samples, in input order (08-REQ-41), per segment. */
  readonly cold: TimedSample[] = [];
  /** Segment of the last cold sample and the cold samples taken in it (17-REQ-15). */
  coldSegment = 0;
  coldInSegment = 0;
  /** Endpoints: samples with an HTTP status outside successStatuses (08-REQ-46). */
  nonSuccessCount = 0;
  /** Endpoints: timed non-success samples per HTTP status (08-REQ-47). */
  readonly failed = new Map<number, { count: number; sample: BottomK }>();
  errorCount = 0;
  fromFailedTests = 0;
  browser = 0;
  node = 0;
  readonly statuses = new Map<string, number>();
  /** Test identity → sample count (08-REQ-29). */
  readonly tests = new Map<string, TestCounter>();
  minTenths = Infinity;
  maxTenths = -Infinity;
  /** Exact integer sum in tenths of a ms (08-REQ-16). */
  sumTenths = 0;
  readonly slowest: SlowCandidate[] = [];
  readonly sample: BottomK;
  /** Steps only: error and unfinished samples from failed tests (06-REQ-32). */
  stepErrorsFromFailedTests = 0;
  /** Steps only: smallest (file, line) location (06-REQ-28). */
  location: { file: string; line: number } | null = null;

  constructor(kind: SampleKind, sample: BottomK) {
    this.kind = kind;
    this.sample = sample;
  }

  countSample(label: string, test: TestMeta, isError: boolean): void {
    this.count += 1;
    this.statuses.set(label, (this.statuses.get(label) ?? 0) + 1);
    if (isError) this.errorCount += 1;
    if (test.failed) this.fromFailedTests += 1;
    const counter = this.tests.get(test.identity);
    if (counter === undefined) {
      this.tests.set(test.identity, {
        title: test.title,
        project: test.project,
        file: test.file,
        line: test.line,
        sampleCount: 1,
      });
    } else {
      counter.sampleCount += 1;
    }
  }

  addSlow(candidate: SlowCandidate): void {
    const list = this.slowest;
    const last = list[SLOWEST - 1];
    if (last !== undefined && compareSlow(candidate, last) >= 0) return;
    list.push(candidate);
    list.sort(compareSlow);
    if (list.length > SLOWEST) list.pop();
  }
}

/**
 * Aggregates the samples of one run per key (08). The result of finalize() does not depend on
 * the order of addRequest() calls (08-REQ-26), except for the choice of cold samples, which are
 * the first timed samples of a key in input order (08-REQ-41). Not thread-safe; finalize() may be
 * called once.
 */
export class Aggregator {
  private readonly opts: AggregatorOptions;
  private readonly isSuccess: (label: string) => boolean;
  private readonly isError: (label: string) => boolean;
  private readonly percentiles: [string, number][];
  private readonly endpoints = new Map<string, KeyState>();
  private readonly steps = new Map<string, KeyState>();
  /** Interned resultIds: the heap stores an index instead of the text (08-REQ-29). */
  private readonly resultIndex = new Map<string, number>();
  private readonly resultIds: string[] = [];
  private readonly origins = new Map<string, { label: string; requestCount: number }>();
  private readonly browsers = new Set<string>();
  private readonly outsideProjects = new Set<string>();
  private outsideSamples = 0;
  private withoutBrowserTiming = 0;
  private readonly keysWithoutBrowserTiming = new Set<string>();
  private readonly testBreakdown = new TestBreakdownBuilder();
  /** Keys for STATS_COLD_SLOW (08-REQ-44), filled by finalize(). */
  private readonly coldSlow: { key: string; max: number; warmP50: number; ratio: number }[] = [];
  private finalized = false;
  /** Input segment: every shard of a merge starts one, so its first samples are cold (17-REQ-15). */
  private segment = 0;

  constructor(opts: AggregatorOptions) {
    this.opts = opts;
    this.isSuccess = compileStatusMatcher(opts.successStatuses);
    this.isError = compileStatusMatcher(opts.errors.statuses);
    this.percentiles = percentileNames(opts.evaluatedPercentile);
  }

  /**
   * Starts a new input segment (08-REQ-41, 17-REQ-15): the cold-sample counter of every key starts
   * again from zero, as each pass (a new Playwright process, with webServer a new start of the
   * application) and each shard machine starts the application again. The caller starts one
   * before every pass after the first and before every shard; without it the whole input is one
   * segment.
   */
  startSegment(): void {
    this.segment += 1;
  }

  /**
   * Adds a request sample under `key`. `origin` and `label` come from the KeyResult (07); null
   * when the URL could not be parsed (07-REQ-23), then the sample is not counted in origins.
   * `browserName` is the batch's collector.browserName (08-REQ-32).
   */
  addRequest(
    key: string,
    sample: EnrichedRequestSample,
    origin: string | null,
    label: string | null,
    browserName: string | null,
  ): void {
    if (!this.accept(sample.test)) return;
    if (browserName !== null) this.browsers.add(browserName);
    if (origin !== null) {
      const entry = this.origins.get(origin);
      const text = label ?? '';
      if (entry === undefined) this.origins.set(origin, { label: text, requestCount: 1 });
      else {
        entry.requestCount += 1;
        // Labels are fixed per origin by the config; the minimum keeps the result order-free.
        if (compareText(text, entry.label) < 0) entry.label = text;
      }
    }

    const state = this.state(this.endpoints, 'request', key);
    const statusLabel = requestStatusLabel(sample);
    const isError = this.isError(statusLabel);
    state.countSample(statusLabel, sample.test, isError);
    if (sample.timeSource === 'node') state.node += 1;
    else state.browser += 1;

    // FAILED and PENDING are never successful (08-REQ-01).
    const successful = typeof sample.status === 'number' && this.isSuccess(statusLabel);
    const apiCall = sample.apiCall === true;
    if (typeof sample.status === 'number' && !successful) {
      state.nonSuccessCount += 1;
      if ((sample.timeSource === 'browser' || apiCall) && sample.duration !== null) {
        this.addFailed(state, key, sample.status, sample.test, sample.ordinal, sample.duration);
      }
    }
    if (successful && sample.timeSource === 'node' && !apiCall) {
      this.withoutBrowserTiming += 1;
      this.keysWithoutBrowserTiming.add(key);
    }
    // Usable for time statistics (08-REQ-02); API calls are timed in the worker (15-REQ-13).
    const usable =
      successful &&
      (sample.timeSource === 'browser' || apiCall) &&
      !sample.fromServiceWorker &&
      sample.duration !== null;
    this.testBreakdown.addRequest(
      sample.test,
      key,
      statusLabel,
      isError,
      usable && sample.duration !== null ? toTenths(sample.duration) : null,
      sample.startTime,
      sample.ordinal,
    );
    if (!usable || sample.duration === null) return;
    this.addTime(state, key, sample.test, sample.ordinal, {
      duration: sample.duration,
      ttfb: sample.ttfb,
      startedAt: sample.startTime,
      ...(this.opts.rawUrls ? { url: sample.url } : {}),
    });
  }

  /**
   * Adds a step sample under its key (08-REQ-40). Only ok samples enter time statistics; error
   * and unfinished samples are errors, except those from failed tests, which only
   * stepErrorsFromFailedTests counts (06-REQ-32). Steps are timed in Node and stay out of the
   * test breakdown (08-D-18).
   */
  addStep(sample: EnrichedStepSample): void {
    if (!this.accept(sample.test)) return;
    const state = this.state(this.steps, 'step', sample.key);
    const failedError = sample.outcome !== 'ok' && sample.test.failed;
    state.countSample(sample.outcome, sample.test, sample.outcome !== 'ok' && !failedError);
    if (failedError) state.stepErrorsFromFailedTests += 1;
    state.node += 1;
    const loc = sample.location;
    if (
      loc !== null &&
      (state.location === null ||
        loc.file < state.location.file ||
        (loc.file === state.location.file && loc.line < state.location.line))
    ) {
      state.location = { file: loc.file, line: loc.line };
    }
    if (sample.outcome !== 'ok' || sample.duration === null || sample.endTime === null) return;
    this.addTime(state, sample.key, sample.test, sample.ordinal, {
      duration: sample.duration,
      ttfb: null,
      startedAt: Math.round(sample.endTime - sample.duration),
    });
  }

  /**
   * Closes one test result after all its samples were added (08-REQ-36); also for a result with
   * an empty batch. Results of projects that are not measured are ignored (08-REQ-31).
   */
  endResult(meta: TestMeta): void {
    if (this.finalized) throw new Error('Aggregator: endResult() after finalize().');
    if (!this.opts.measuredProjects.has(meta.project)) return;
    this.testBreakdown.endResult(meta);
  }

  /** Builds the aggregates; may be called once. */
  finalize(): Aggregates {
    if (this.finalized) throw new Error('Aggregator.finalize() may be called once.');
    this.finalized = true;
    return {
      endpoints: this.build(this.endpoints),
      steps: this.buildSteps(),
      origins: [...this.origins.keys()].sort(compareText).map((origin) => {
        const entry = this.origins.get(origin) ?? { label: '', requestCount: 0 };
        return { origin, label: entry.label, requestCount: entry.requestCount };
      }),
      issues: this.issues(),
      testBreakdown: this.testBreakdown.build(),
    };
  }

  /** False for samples of projects that are not measured (08-REQ-31). */
  private accept(test: TestMeta): boolean {
    if (this.finalized) throw new Error('Aggregator: samples added after finalize().');
    if (this.opts.measuredProjects.has(test.project)) return true;
    if (this.opts.dependencyProjects?.has(test.project) === true) return false;
    this.outsideSamples += 1;
    this.outsideProjects.add(test.project);
    return false;
  }

  private state(states: Map<string, KeyState>, kind: SampleKind, key: string): KeyState {
    let state = states.get(key);
    if (state === undefined) {
      const ids = this.resultIds;
      state = new KeyState(
        kind,
        new BottomK(this.opts.advanced.maxSamplesPerKey, (r, ordinal) =>
          sampleId(ids[r] ?? '', kind, ordinal),
        ),
      );
      states.set(key, state);
    }
    return state;
  }

  private addTime(
    state: KeyState,
    key: string,
    test: TestMeta,
    ordinal: number,
    time: TimedSample['time'],
  ): void {
    state.timed += 1;
    // The first timed samples of the key in each segment wait until finalize() decides on them
    // (08-REQ-42, 17-REQ-15).
    if (state.coldSegment !== this.segment) {
      state.coldSegment = this.segment;
      state.coldInSegment = 0;
    }
    if (state.coldInSegment < (this.opts.coldSamples ?? 0)) {
      state.coldInSegment += 1;
      state.cold.push({ test, ordinal, time });
      return;
    }
    this.addWarm(state, key, test, ordinal, time);
  }

  /** Adds a timed sample to the time statistics (08-REQ-02). */
  private addWarm(
    state: KeyState,
    key: string,
    test: TestMeta,
    ordinal: number,
    time: TimedSample['time'],
  ): void {
    const tenths = toTenths(time.duration);
    state.successCount += 1;
    state.sumTenths += tenths;
    if (tenths < state.minTenths) state.minTenths = tenths;
    if (tenths > state.maxTenths) state.maxTenths = tenths;

    const r = this.resultIndexOf(test.resultId);
    const id = sampleId(test.resultId, state.kind, ordinal);
    // Priority from the key, the sample identity and the seed only (08-REQ-12, 08-REQ-13).
    const priority = hash53(`${key}\u0000${id}`, this.opts.advanced.seed);
    state.sample.add(priority, tenths, time.ttfb === null ? -1 : toTenths(time.ttfb), r, ordinal);
    state.addSlow({
      tenths,
      startedAt: time.startedAt,
      test,
      ordinal,
      sampleId: id,
      ...(time.url === undefined ? {} : { url: time.url }),
    });
  }

  /** A timed non-success sample (08-REQ-47), kept with bottom-k per status like 08-REQ-12. */
  private addFailed(
    state: KeyState,
    key: string,
    status: number,
    test: TestMeta,
    ordinal: number,
    duration: number,
  ): void {
    let entry = state.failed.get(status);
    if (entry === undefined) {
      const ids = this.resultIds;
      const kind = state.kind;
      entry = {
        count: 0,
        sample: new BottomK(this.opts.advanced.maxSamplesPerKey, (r, o) =>
          sampleId(ids[r] ?? '', kind, o),
        ),
      };
      state.failed.set(status, entry);
    }
    entry.count += 1;
    const r = this.resultIndexOf(test.resultId);
    const id = sampleId(test.resultId, state.kind, ordinal);
    const priority = hash53(`${key}\u0000${id}`, this.opts.advanced.seed);
    entry.sample.add(priority, toTenths(duration), -1, r, ordinal);
  }

  private resultIndexOf(resultId: string): number {
    let r = this.resultIndex.get(resultId);
    if (r === undefined) {
      r = this.resultIds.length;
      this.resultIds.push(resultId);
      this.resultIndex.set(resultId, r);
    }
    return r;
  }

  /**
   * Decides on the cold samples of a key (08-REQ-42): when at least minSamples warm samples are
   * left they stay out of the statistics, otherwise they are added to them. Returns the
   * cold block (08-REQ-43); warmP50 is the p50 of the warm samples alone.
   */
  private settleCold(state: KeyState, key: string): AggregateStats['cold'] {
    if (state.cold.length === 0) return null;
    const minSamples = this.opts.minSamples ?? 5;
    const excluded = state.timed >= state.cold.length + minSamples;
    // Computed like stats.percentiles.p50, so that both are equal when the cold samples are excluded.
    const p50 = (): number | null => {
      const all = state.sample.durations().map((t) => t / 10);
      return all.length === 0 ? null : roundMs(percentile(all, 50) ?? 0);
    };
    let warmP50 = p50();
    if (!excluded) {
      for (const c of state.cold) this.addWarm(state, key, c.test, c.ordinal, c.time);
      // Only cold samples (a key called once per pass): the p50 of all of them (08-REQ-43).
      if (warmP50 === null) warmP50 = p50();
    }
    const durations = state.cold.slice(0, COLD_KEPT).map((c) => toTenths(c.time.duration) / 10);
    const max = Math.max(...state.cold.map((c) => toTenths(c.time.duration))) / 10;
    const first = state.cold[0] as TimedSample;
    const ratio =
      warmP50 === null || warmP50 === 0 ? null : Math.round((max / warmP50) * 100) / 100;
    if (ratio !== null && warmP50 !== null && ratio >= COLD_WARN_RATIO) {
      if (max - warmP50 >= COLD_WARN_GAP_MS) this.coldSlow.push({ key, max, warmP50, ratio });
    }
    return {
      count: state.cold.length,
      excluded,
      reason: excluded ? null : 'too-few-samples',
      durations,
      max,
      warmP50,
      ratio,
      test: testRefOf(first.test),
    } as AggregateStats['cold'];
  }

  private build(states: Map<string, KeyState>): Record<string, AggregateStats> {
    const result: Record<string, AggregateStats> = {};
    for (const key of [...states.keys()].sort(compareText)) {
      const state = states.get(key);
      if (state !== undefined) result[key] = this.aggregate(state, key);
    }
    return result;
  }

  private buildSteps(): Record<string, StepAggregateStats> {
    const result: Record<string, StepAggregateStats> = {};
    for (const key of [...this.steps.keys()].sort(compareText)) {
      const state = this.steps.get(key);
      if (state === undefined) continue;
      result[key] = {
        ...this.aggregate(state, key),
        location: state.location,
        stepErrorsFromFailedTests: state.stepErrorsFromFailedTests,
      } as StepAggregateStats;
    }
    return result;
  }

  private aggregate(state: KeyState, key: string): AggregateStats {
    const cold = this.settleCold(state, key);
    const durations = state.sample.durations().map((t) => t / 10);
    const ttfbs = state.sample.ttfbs().map((t) => t / 10);
    const others = state.sample.othersThanTtfb().map((t) => t / 10);
    const at = (sorted: number[], p: number): number => roundMs(percentile(sorted, p) ?? 0);
    const statuses: Record<string, number> = {};
    for (const label of [...state.statuses.keys()].sort(compareText)) {
      statuses[label] = state.statuses.get(label) ?? 0;
    }
    const usable = state.successCount > 0;
    return {
      count: state.count,
      successCount: state.successCount,
      errorCount: state.errorCount,
      fromFailedTests: state.fromFailedTests,
      testCount: state.tests.size,
      statuses,
      timeSources: { browser: state.browser, node: state.node },
      stats: usable
        ? {
            min: state.minTenths / 10,
            avg: Math.round(state.sumTenths / state.successCount) / 10,
            max: state.maxTenths / 10,
            percentiles: Object.fromEntries(
              this.percentiles.map(([name, p]) => [name, at(durations, p)]),
            ),
          }
        : null,
      ttfb:
        ttfbs.length === 0
          ? null
          : { p50: at(ttfbs, 50), p95: at(ttfbs, 95), otherP50: at(others, 50) },
      slowest: state.slowest.map((s): SlowSample => ({
        duration: s.tenths / 10,
        startedAt: new Date(s.startedAt).toISOString(),
        test: testRefOf(s.test),
        ...(s.url === undefined ? {} : { url: s.url }),
      })) as AggregateStats['slowest'],
      topTests: [...state.tests.values()]
        .map(({ title, project, file, line, sampleCount }) => ({
          title,
          project,
          file,
          line,
          sampleCount,
        }))
        .sort(compareTopTests)
        .slice(0, TOP_TESTS) as AggregateStats['topTests'],
      samples: {
        durations,
        sampled: state.successCount > this.opts.advanced.maxSamplesPerKey,
      },
      // Bins of the retained durations; null exactly when stats is null (08-REQ-34).
      histogram: (usable ? histogram(durations) : null) as AggregateStats['histogram'],
      cold,
      nonSuccessCount: state.kind === 'step' ? null : state.nonSuccessCount,
      failedTimings: this.failedTimings(state),
    } as AggregateStats;
  }

  /** Up to 5 statuses with the most timed samples, ties by code (08-REQ-47). */
  private failedTimings(state: KeyState): AggregateStats['failedTimings'] {
    return [...state.failed.entries()]
      .sort(([a, x], [b, y]) => y.count - x.count || a - b)
      .slice(0, FAILED_STATUSES)
      .map(([status, { count, sample }]) => {
        const sorted = sample.durations().map((t) => t / 10);
        return {
          status,
          count,
          p50: roundMs(percentile(sorted, 50) ?? 0),
          p95: roundMs(percentile(sorted, 95) ?? 0),
        };
      }) as AggregateStats['failedTimings'];
  }

  private issues(): StatsIssue[] {
    const issues: StatsIssue[] = [];
    const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
    if (this.withoutBrowserTiming > 0) {
      const n = this.withoutBrowserTiming;
      issues.push({
        code: 'STATS_SAMPLES_WITHOUT_BROWSER_TIMING',
        message:
          `${plural(n, 'successful request sample')} in ` +
          `${plural(this.keysWithoutBrowserTiming.size, 'endpoint key')} ` +
          `had no browser timing (timeSource "node") and ${n === 1 ? 'was' : 'were'} left out ` +
          'of the time statistics.',
        hint: 'Browser timing is missing for some requests (e.g. when the browser reports no timing for them); they still count in count and statuses.',
      });
    }
    if (this.outsideSamples > 0) {
      const projects = [...this.outsideProjects].sort(compareText).join(', ');
      issues.push({
        code: 'STATS_SAMPLES_OUTSIDE_MEASURED_PROJECTS',
        message: `${plural(this.outsideSamples, 'sample')} from projects that are not measured (${projects}) were not aggregated.`,
        hint: 'Setup and teardown projects run once and are not measured; move the calls you want to measure into tests of a measured project.',
      });
    }
    if (this.browsers.size > 1) {
      const names = [...this.browsers].sort(compareText).join(', ');
      issues.push({
        code: 'STATS_MULTIPLE_BROWSERS',
        message: `Request samples come from more than one browser (${names}); timings of different engines are mixed in the same keys.`,
        hint: 'Measure one browser engine per run: select projects of one engine with --project in the measurement command.',
      });
    }
    if (this.coldSlow.length > 0) {
      const n = this.coldSlow.length;
      const top = [...this.coldSlow]
        .sort((a, b) => b.ratio - a.ratio || compareText(a.key, b.key))
        .slice(0, COLD_WARN_KEYS)
        .map(
          (c) =>
            `${c.key} ${formatWholeMs(c.max)} ms vs warm p50 ${formatWholeMs(c.warmP50)} ms (×${c.ratio.toFixed(1)})`,
        );
      issues.push({
        code: 'STATS_COLD_SLOW',
        message:
          `${plural(n, 'key')} ${n === 1 ? 'is' : 'are'} much slower on the first call (cold start): ` +
          `${top.join(', ')}${n > COLD_WARN_KEYS ? ', …' : ''}.`,
        hint: 'The first calls in each pass stay out of the evaluated statistics when a key has enough warm samples (checks.time.median.minSamples). To measure the first calls too, warm the application up before the tests or set measure.coldSamples to 0.',
      });
    }
    return issues;
  }
}

/** Whole milliseconds with thousands separators, as in other messages (e.g. "1,840"). */
function formatWholeMs(ms: number): string {
  return Math.round(ms).toLocaleString('en-US');
}

function testRefOf(test: TestMeta): SlowSample['test'] {
  return {
    title: test.title,
    project: test.project,
    file: test.file,
    line: test.line,
    repeatEachIndex: test.repeatEachIndex,
  };
}

/**
 * Adds a request sample under the key built by the normalization (07): `keyOf` is the function
 * from createKeyBuilder(). A sample whose URL the normalization skips is not added. Returns the
 * KeyResult so that the caller can report its issues.
 */
export function addKeyedRequest(
  aggregator: Aggregator,
  keyOf: (sample: KeySample) => KeyResult,
  sample: EnrichedRequestSample,
  browserName: string | null,
): KeyResult {
  const result = keyOf(sample);
  if (result.ok) {
    aggregator.addRequest(result.key, sample, result.origin, result.label, browserName);
  }
  return result;
}

/** An APIRequestContext call of a batch with the test metadata (15-REQ-05). */
export interface EnrichedApiRequestSample extends RawApiRequestSample {
  test: TestMeta;
  /** Position after the browser samples of the same batch (08-REQ-08). */
  ordinal: number;
}

/**
 * Adds an APIRequestContext call under its own key: the normalization's key (keyBuilder gets
 * resourceType "request") with REQUEST_KEY_PREFIX (15-REQ-01, 15-REQ-02). The returned
 * KeyResult has the prefixed key.
 */
export function addKeyedApiRequest(
  aggregator: Aggregator,
  keyOf: (sample: KeySample) => KeyResult,
  sample: EnrichedApiRequestSample,
): KeyResult {
  const result = keyOf({
    method: sample.method,
    url: sample.url,
    resourceType: 'request',
    operation: sample.operation ?? null,
  });
  if (!result.ok) return result;
  const key = `${REQUEST_KEY_PREFIX}${result.key}`;
  const request: EnrichedRequestSample = {
    method: sample.method,
    url: sample.url,
    resourceType: 'request',
    status: sample.status,
    ...(sample.failureText === undefined ? {} : { failureText: sample.failureText }),
    startTime: sample.startTime,
    duration: sample.duration,
    requestStart: null,
    ttfb: null,
    timeSource: 'node',
    fromServiceWorker: false,
    test: sample.test,
    ordinal: sample.ordinal,
    apiCall: true,
  };
  aggregator.addRequest(key, request, result.origin, result.label, null);
  return { ...result, key };
}
