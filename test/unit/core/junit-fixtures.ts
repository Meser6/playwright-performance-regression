// Run reports for the junit.xml tests (16): the warned report of golden case G2 and the reference
// report of the size budget (16-REQ-17).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate } from '../../../src/core/evaluate/index.ts';
import { buildRunReport } from '../../../src/core/report/index.ts';
import type { Aggregate, Check, RunReport, StepAggregate } from '../../../src/core/types/index.ts';
import { largeReport } from '../html/fixtures.ts';
import {
  EVALUATE_GOLDEN_DIR,
  NO_TEST_BREAKDOWN,
  aggregates,
  config,
  files,
  options,
} from './evaluate-helpers.ts';
import type { EvaluateGoldenCase } from './evaluate-helpers.ts';
import { loadCases } from '../../contract/golden.ts';

function fullRunInput(): RunReport {
  const found = loadCases('run-report').find(
    (c) => c.dir === 'valid' && c.file === 'full-run.json',
  );
  return structuredClone(found?.input) as RunReport;
}

/**
 * The run report of golden case G2 (tolerance 2, two keys over their limits, nothing blocks):
 * evaluation status `warned` (16-AC-03), on the metadata of the full-run golden report.
 */
export function warnedReport(): RunReport {
  const c = JSON.parse(
    readFileSync(join(EVALUATE_GOLDEN_DIR, 'G2-tolerance-tolerates.json'), 'utf8'),
  ) as Omit<EvaluateGoldenCase, 'file'>;
  const base = fullRunInput();
  const cfg = config(c.input.config);
  const aggs = aggregates(c.input.aggregates.endpoints, cfg.checks.time.percentile.level);
  const evaluation = evaluate(
    aggs,
    { ...files(), ...c.input.thresholds },
    cfg,
    options(c.input.options),
  );
  return buildRunReport({
    meta: base,
    config: { ...base.config, gate: { ...base.config.gate, tolerance: 2 } },
    normalization: base.normalization,
    stepNormalization: null,
    runConditions: base.runConditions,
    tests: base.tests,
    aggregates: { steps: {}, ...aggs, origins: [], testBreakdown: NO_TEST_BREAKDOWN },
    evaluation,
    warnings: evaluation.warnings,
    toolErrors: evaluation.toolErrors,
  });
}

/**
 * The reference report of 16-REQ-17: 500 endpoint and 500 step keys, every fifth key (20%) with
 * three blocking violations, every eleventh other key not evaluated.
 */
export function junitReferenceReport(): RunReport {
  const large = largeReport(500, 10);
  const endpoints: Record<string, Aggregate> = {};
  const steps: Record<string, StepAggregate> = {};
  // Every check of an evaluated key (largeReport leaves the checks of its not evaluated keys empty).
  const allChecks = (Object.values(large.endpoints)[1] as Aggregate).evaluation.checks;
  Object.entries(large.endpoints).forEach(([key, aggregate], i) => {
    const fail = i % 5 === 0;
    const notEvaluated = !fail && i % 11 === 0;
    const checks: Check[] = notEvaluated
      ? []
      : allChecks.map((c, j) => {
          const failed = fail && j < 3;
          return {
            ...c,
            limit: failed ? c.actual / 2 : c.limit,
            passed: !failed,
            blocking: failed,
          };
        });
    const evaluated: Aggregate = {
      ...aggregate,
      evaluation: {
        ...aggregate.evaluation,
        result: fail ? 'fail' : notEvaluated ? 'not-evaluated' : 'pass',
        reason: notEvaluated ? 'too-few-samples' : null,
        checks,
      },
    };
    endpoints[key] = evaluated;
    steps[`checkout › step ${String(i).padStart(4, '0')} › fill the shipping address form`] = {
      ...evaluated,
      location: { file: 'pages/checkout.page.ts', line: i + 1 },
      stepErrorsFromFailedTests: 0,
    };
  });
  return { ...large, endpoints, steps };
}
