// Per-test costs and the waterfall of the slowest test runs (08, chapter 7.1: 08-REQ-37,
// 08-REQ-38, 08-REQ-39). Only api request samples count (P-04, 08-D-18).
import type { TestCost, Waterfall } from '../types/index.ts';
import type { TestMeta } from './identity.ts';

/** Tests stored in the report (08-REQ-37). */
export const MAX_TESTS = 500;
/** Waterfalls stored in the report (08-REQ-38, 08-D-19). */
export const MAX_WATERFALLS = 5;
/** Requests per waterfall (08-REQ-38). */
export const MAX_WATERFALL_REQUESTS = 200;
const TOP_KEYS = 3;

/** A test cost before buildRunReport adds violatedKeys from the evaluation (08-REQ-37). */
export type TestCostStats = Omit<TestCost, 'violatedKeys' | 'violatedKeyCount'> & {
  /** Every key of the test, sorted (UTF-16 code units). */
  keys: string[];
};

export interface TestBreakdownStats {
  tests: TestCostStats[];
  omitted: number;
  waterfalls: Waterfall[];
}

/** Code unit order, never localeCompare (02-REQ-04). */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface TestState {
  title: string;
  project: string;
  file: string;
  line: number;
  executions: number;
  requestCount: number;
  errorCount: number;
  tenths: number;
  /** Longest time-usable request in tenths of a ms; -1 without one. */
  maxTenths: number;
  /**
   * Key → position in `counts` and `sums` (08-REQ-39): parallel arrays of small integers keep
   * about 50 bytes per key of a test instead of an object per key.
   */
  readonly keys: Map<string, number>;
  readonly counts: number[];
  /** Sum of time-usable durations per key in whole tenths of a ms (08-REQ-16). */
  readonly sums: number[];
}

interface BufferedRequest {
  startTime: number;
  /** Tenths of a ms of a time-usable sample, otherwise null. */
  tenths: number | null;
  key: string;
  status: string;
  ordinal: number;
}

interface Candidate {
  meta: TestMeta;
  tenths: number;
  waterfall: Waterfall;
}

type Identity = Pick<TestMeta, 'file' | 'line' | 'project' | 'title'>;

function compareIdentity(a: Identity, b: Identity): number {
  return (
    compareText(a.file, b.file) ||
    a.line - b.line ||
    compareText(a.project, b.project) ||
    compareText(a.title, b.title)
  );
}

/** Order of the tests in the report: totalMs, requestCount, then file, line, project, title. */
function compareTests(a: TestState, b: TestState): number {
  return b.tenths - a.tenths || b.requestCount - a.requestCount || compareIdentity(a, b);
}

/** The slowest run of one test: largest total, then smaller repeatEachIndex, then retry. */
function compareRunsOfTest(a: Candidate, b: Candidate): number {
  return (
    b.tenths - a.tenths ||
    a.meta.repeatEachIndex - b.meta.repeatEachIndex ||
    a.meta.retry - b.meta.retry
  );
}

/** Order of the waterfalls: total of the slowest run, then file, line, project, title. */
function compareWaterfalls(a: Candidate, b: Candidate): number {
  return b.tenths - a.tenths || compareIdentity(a.meta, b.meta);
}

/**
 * Collects the per-test data of one run. The result does not depend on the order of the test
 * results (08-REQ-26): sums are exact integers, and the waterfall keeps at most 5 candidates in a
 * total order, one per test (08-REQ-38).
 */
export class TestBreakdownBuilder {
  private readonly tests = new Map<string, TestState>();
  /** Requests of the test results not closed yet, by resultId (08-REQ-39). */
  private readonly open = new Map<string, BufferedRequest[]>();
  private candidates: Candidate[] = [];

  /** An api request sample of `meta`; `tenths` is null when it is not time-usable (08-REQ-02). */
  addRequest(
    meta: TestMeta,
    key: string,
    status: string,
    isError: boolean,
    tenths: number | null,
    startTime: number,
    ordinal: number,
  ): void {
    const test = this.test(meta);
    test.requestCount += 1;
    if (isError) test.errorCount += 1;
    let index = test.keys.get(key);
    if (index === undefined) {
      index = test.counts.length;
      test.keys.set(key, index);
      test.counts.push(0);
      test.sums.push(0);
    }
    test.counts[index] = (test.counts[index] ?? 0) + 1;
    if (tenths !== null) {
      test.tenths += tenths;
      test.sums[index] = (test.sums[index] ?? 0) + tenths;
      if (tenths > test.maxTenths) test.maxTenths = tenths;
    }
    let buffer = this.open.get(meta.resultId);
    if (buffer === undefined) {
      buffer = [];
      this.open.set(meta.resultId, buffer);
    }
    buffer.push({ startTime, tenths, key, status, ordinal });
  }

  /** Closes one test result: counts the run and offers it to the waterfall (08-REQ-36). */
  endResult(meta: TestMeta): void {
    this.test(meta).executions += 1;
    const requests = this.open.get(meta.resultId) ?? [];
    this.open.delete(meta.resultId);
    let tenths = 0;
    let usable = false;
    for (const r of requests) {
      if (r.tenths === null) continue;
      tenths += r.tenths;
      usable = true;
    }
    // Runs without time-usable samples have no waterfall (08-REQ-38).
    if (!usable) return;
    this.offer({ meta, tenths, waterfall: waterfallOf(meta, tenths, requests) });
  }

  build(): TestBreakdownStats {
    const states = [...this.tests.values()].filter((t) => t.requestCount > 0).sort(compareTests);
    return {
      tests: states.slice(0, MAX_TESTS).map(costOf),
      omitted: Math.max(0, states.length - MAX_TESTS),
      waterfalls: this.candidates.map((c) => c.waterfall),
    };
  }

  private test(meta: TestMeta): TestState {
    let test = this.tests.get(meta.identity);
    if (test === undefined) {
      test = {
        title: meta.title,
        project: meta.project,
        file: meta.file,
        line: meta.line,
        executions: 0,
        requestCount: 0,
        errorCount: 0,
        tenths: 0,
        maxTenths: -1,
        keys: new Map(),
        counts: [],
        sums: [],
      };
      this.tests.set(meta.identity, test);
    }
    return test;
  }

  private offer(candidate: Candidate): void {
    const list = this.candidates;
    const same = list.findIndex((c) => c.meta.identity === candidate.meta.identity);
    if (same !== -1) {
      const current = list[same];
      if (current === undefined || compareRunsOfTest(candidate, current) >= 0) return;
      list[same] = candidate;
    } else if (list.length < MAX_WATERFALLS) {
      list.push(candidate);
    } else {
      const weakest = list[list.length - 1];
      if (weakest === undefined || compareWaterfalls(candidate, weakest) >= 0) return;
      list[list.length - 1] = candidate;
    }
    list.sort(compareWaterfalls);
  }
}

function costOf(test: TestState): TestCostStats {
  const keys = [...test.keys.keys()].sort(compareText);
  const topKeys = keys
    .map((key) => {
      const index = test.keys.get(key) ?? -1;
      return { key, count: test.counts[index] ?? 0, tenths: test.sums[index] ?? 0 };
    })
    .sort((a, b) => b.tenths - a.tenths || b.count - a.count || compareText(a.key, b.key))
    .slice(0, TOP_KEYS)
    .map(({ key, count, tenths }) => ({ key, count, totalMs: tenths / 10 }));
  return {
    title: test.title,
    project: test.project,
    file: test.file,
    line: test.line,
    executions: test.executions,
    requestCount: test.requestCount,
    errorCount: test.errorCount,
    totalMs: test.tenths / 10,
    maxRequestMs: test.maxTenths < 0 ? null : test.maxTenths / 10,
    keyCount: keys.length,
    topKeys: topKeys as TestCost['topKeys'],
    keys,
  };
}

/** Offsets from TestResult.startTime in whole ms, sorted by offset, then ordinal (08-REQ-38). */
function waterfallOf(meta: TestMeta, tenths: number, requests: BufferedRequest[]): Waterfall {
  const rows = requests
    .map((r) => ({ ...r, offset: Math.max(0, Math.round(r.startTime - meta.startTime)) }))
    .sort((a, b) => a.offset - b.offset || a.ordinal - b.ordinal);
  let span = 0;
  for (const r of rows) span = Math.max(span, r.offset * 10 + (r.tenths ?? 0));
  const shown = rows.slice(0, MAX_WATERFALL_REQUESTS);
  return {
    test: {
      title: meta.title,
      project: meta.project,
      file: meta.file,
      line: meta.line,
      repeatEachIndex: meta.repeatEachIndex,
    },
    totalMs: tenths / 10,
    requestCount: rows.length,
    spanMs: span / 10,
    requests: shown.map((r) => ({
      offset: r.offset,
      duration: r.tenths === null ? null : r.tenths / 10,
      key: r.key,
      status: r.status,
    })),
    omitted: rows.length - shown.length,
  };
}
