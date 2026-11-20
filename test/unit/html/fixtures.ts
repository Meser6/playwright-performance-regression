// Run reports for the HTML report tests: golden reports and synthetic large ones.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Aggregate, Check, RunReport } from '../../../src/core/types/index.ts';
import { checkUsage } from '../../../src/core/report/index.ts';
import { histogram } from '../../../src/core/stats/index.ts';
import { GOLDEN_DIR } from '../../contract/golden.ts';

export const RUN_REPORTS = join(GOLDEN_DIR, 'run-report', 'valid');
export const HTML_DATA = join(GOLDEN_DIR, 'html', 'data');
export const HTML_PAGE = join(GOLDEN_DIR, 'html', 'page');

export function readCase(file: string): { name: string; input: RunReport } {
  return JSON.parse(readFileSync(file, 'utf8')) as { name: string; input: RunReport };
}

/** Names of the valid run report golden cases (sources of html/data). */
export function runReportNames(): string[] {
  return readdirSync(RUN_REPORTS)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

/** Inputs of the html/page golden cases: every run report case plus the page-only cases. */
export function pageCases(): { name: string; report: RunReport }[] {
  const own = readdirSync(HTML_PAGE)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({
      name: f.slice(0, -'.json'.length),
      report: readCase(join(HTML_PAGE, f)).input,
    }));
  const shared = runReportNames().map((name) => ({
    name,
    report: readCase(join(RUN_REPORTS, `${name}.json`)).input,
  }));
  return [...shared, ...own].sort((a, b) => (a.name < b.name ? -1 : 1));
}

export function fullRun(): RunReport {
  return readCase(join(RUN_REPORTS, 'full-run.json')).input;
}

/** The v1 golden report after migration (11-REQ-44). */
export function migratedCase(): RunReport {
  return readCase(join(HTML_PAGE, 'migrated-v1.json')).input;
}

export function markupCase(): RunReport {
  return readCase(join(HTML_PAGE, 'violations-muted-markup.json')).input;
}

function check(rule: Check['rule'], actual: number, limit: number, passed: boolean): Check {
  return {
    rule,
    n: 5000,
    actual,
    observed: rule === 'median' || rule === 'percentile' || rule === 'p99' ? null : 0.01,
    limit,
    passed,
    hardLimitExceeded: false,
    blocking: !passed,
    usage: checkUsage({ rule, actual, limit }),
  };
}

/**
 * A report with `keys` endpoints, each with 3 slowest samples, every check and `retained`
 * durations (11-AC-04). Every seventh key fails, every eleventh is not evaluated.
 */
export function largeReport(keys: number, retained: number): RunReport {
  const base = fullRun();
  const template = base.endpoints['GET /api/tickets/:id'] as Aggregate;
  const endpoints: Record<string, Aggregate> = {};
  for (let i = 0; i < keys; i++) {
    const key = `GET /api/resource-${String(i).padStart(4, '0')}/items/:id?filter&page`;
    const p95 = 100 + ((i * 37) % 900);
    const fail = i % 7 === 0;
    const notEvaluated = !fail && i % 11 === 0;
    const durations = Array.from(
      { length: retained },
      (_, j) => Math.round((50 + ((j * 997) % 1000) + i / 10) * 10) / 10,
    ).sort((a, b) => a - b);
    const slowest = [0, 1, 2].map((j) => ({
      ...(template.slowest[0] as Aggregate['slowest'][number]),
      duration: 1100 - j,
    }));
    endpoints[key] = {
      ...template,
      count: retained,
      successCount: retained,
      errorCount: i % 5,
      stats: {
        min: 50,
        avg: 500,
        max: 1100,
        percentiles: { p50: 300 + (i % 50), p90: p95 - 10, p95, p99: 1000 },
      },
      slowest: slowest as Aggregate['slowest'],
      samples: { durations, sampled: false },
      histogram: histogram(durations) as Aggregate['histogram'],
      evaluation: {
        ...template.evaluation,
        muted: null,
        result: fail ? 'fail' : notEvaluated ? 'not-evaluated' : 'pass',
        reason: notEvaluated ? 'too-few-samples' : null,
        checks: notEvaluated
          ? []
          : [
              check('median', 300, 900, true),
              check('percentile', p95, fail ? 100 : 1400, !fail),
              check('p99', 1000, 2100, true),
              check('apdex', 0.95, 0.85, true),
              check('wilson', 0.01, 0.05, true),
              check('errors', 0.001, 0.05, true),
            ],
      },
    };
  }
  return { ...base, endpoints };
}

const REFERENCE_KEY = (i: number): string =>
  `GET /api/v2/resource-${String(i).padStart(4, '0')}/items/:itemId/details?filter&page`;

/**
 * The reference report of the size budget (11-REQ-43, 11-AC-25): 500 endpoint keys of about 60
 * characters, each with every check, 3 slowest samples, 5 top tests, a histogram of 30 bins,
 * 3 hints and the TTFB split; 500 tests with 3 top keys and 2 violated keys; 5 waterfalls of
 * 200 requests. `retained` durations per key.
 */
export function referenceReport(retained = 100): RunReport {
  const large = largeReport(500, retained);
  const base = fullRun();
  const template = base.endpoints['GET /api/tickets/:id'] as Aggregate;
  const topTest = template.topTests[0] as Aggregate['topTests'][number];
  const endpoints: Record<string, Aggregate> = {};
  const keys: string[] = [];
  Object.values(large.endpoints).forEach((agg, i) => {
    const key = REFERENCE_KEY(i);
    keys.push(key);
    const counts = Array.from({ length: 30 }, (_, b) => (b < 29 ? Math.floor(retained / 30) : 0));
    counts[29] = retained - counts.reduce((a, b) => a + b, 0);
    endpoints[key] = {
      ...agg,
      ttfb: { p50: 120.4, p95: 310.2, otherP50: 64.8 },
      topTests: Array.from({ length: 5 }, (_, t) => ({
        ...topTest,
        title: `tickets › opens ticket ${String(t + 1)}`,
        line: topTest.line + t,
        sampleCount: 50 - t,
      })) as Aggregate['topTests'],
      histogram: {
        edges: Array.from({ length: 31 }, (_, b) => Math.round((10 + b * 41.27) * 100) / 100),
        counts,
      } as Aggregate['histogram'],
      hints: [
        { code: 'HINT_TAIL', params: { usage: 1.2345, medianUsage: 0.4567 } },
        { code: 'HINT_OUTLIERS', params: { usage: 1.1234, max: 1100 } },
        { code: 'HINT_FAILED_TESTS', params: { share: 0.5123 } },
      ],
    };
  });
  const failing = keys.filter((_, i) => i % 7 === 0);
  const tests = Array.from({ length: 500 }, (_, t) => ({
    title: `checkout › pays with a saved card ${String(t)}`,
    project: 'chromium',
    file: `tests/checkout/payments-${String(t % 40)}.spec.ts`,
    line: 10 + t,
    executions: 5,
    requestCount: 120,
    errorCount: t % 3,
    totalMs: 54321.5 - t,
    maxRequestMs: 1234.5,
    keyCount: 30,
    topKeys: [0, 1, 2].map((k) => ({
      key: keys[(t + k * 13) % keys.length] as string,
      count: 20 - k,
      totalMs: 4321.5 - k,
    })),
    violatedKeys: [failing[t % failing.length], failing[(t + 1) % failing.length]] as string[],
    violatedKeyCount: 2,
  })) as NonNullable<RunReport['testBreakdown']>['tests'];
  const { sampleCount: _count, ...ref } = topTest;
  const waterfalls = Array.from({ length: 5 }, (_, w) => ({
    test: { ...ref, title: `checkout › slow run ${String(w)}`, repeatEachIndex: w },
    totalMs: 98765.4,
    requestCount: 230,
    spanMs: 45678.9,
    requests: Array.from({ length: 200 }, (_, r) => ({
      offset: r * 220,
      duration: r % 25 === 0 ? null : 123.4 + r,
      // A run calls about 40 endpoints, several of them many times.
      key: keys[(r * 7 + w) % 40] as string,
      status: r % 25 === 0 ? 'FAILED' : r % 17 === 0 ? '404' : '200',
    })),
    omitted: 30,
  })) as NonNullable<RunReport['testBreakdown']>['waterfalls'];
  return { ...large, endpoints, testBreakdown: { tests, omitted: 0, waterfalls } };
}

/**
 * fullRun() with two step keys (06, 11-REQ-47): "login › submit" and a title with markup. The
 * step aggregates reuse endpoint aggregates with a location.
 */
export function stepsRun(): RunReport {
  const report = fullRun();
  const [first, second] = Object.values(report.endpoints);
  if (first === undefined || second === undefined) throw new Error('fullRun needs two endpoints');
  const asStep = (a: typeof first, line: number) => ({
    ...structuredClone(a),
    ttfb: null,
    timeSources: { browser: 0, node: a.count },
    location: { file: 'pages/login.page.ts', line },
    stepErrorsFromFailedTests: 0,
  });
  report.steps = {
    'login › submit': asStep(first, 12),
    '<img src=x onerror=alert(1)>': asStep(second, 30),
  };
  report.evaluation.counts.step = { ...report.evaluation.counts.api, keys: 2 };
  return report;
}
