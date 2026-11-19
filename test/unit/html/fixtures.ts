// Run reports for the HTML report tests: golden reports and synthetic large ones.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Aggregate, Check, RunReport } from '../../../src/core/types/index.ts';
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
  return { ...base, endpoints, custom: {} };
}
