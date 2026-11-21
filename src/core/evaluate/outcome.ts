// Run trustworthiness and the exit code of the outcome file (09, chapter 6.4).
import type { ResolvedConfig } from '../config/index.ts';
import { SCHEMA_VERSIONS } from '../schema/index.ts';
import type { Issue, Outcome, RunReport } from '../types/index.ts';
import { plural } from './files.ts';

export interface RunAssessmentInput {
  tests: RunReport['tests'];
  /** FullConfig.maxFailures; 0 when not set. */
  maxFailures: number;
  /** FullConfig.shard is not null. */
  sharded: boolean;
}

export interface RunAssessment {
  warnings: Issue[];
  toolErrors: Issue[];
}

function percent(share: number): string {
  return `${Math.round(share * 1000) / 10}%`;
}

/**
 * Whether the run result can be trusted, from the Playwright results (09-REQ-24). Pure: failed
 * tests are a warning up to gate.maxFailedTestShare and a tool error above it; an incomplete or
 * sharded run is a tool error.
 */
export function assessRun(
  input: RunAssessmentInput,
  gate: Pick<ResolvedConfig['gate'], 'maxFailedTestShare'>,
): RunAssessment {
  const { tests, maxFailures, sharded } = input;
  const warnings: Issue[] = [];
  const toolErrors: Issue[] = [];
  const executions = tests.expected + tests.unexpected + tests.flaky;
  const share = executions === 0 ? 0 : tests.unexpected / executions;
  const failedText = `${tests.unexpected} of ${plural(executions, 'test execution')} failed`;

  if (share > gate.maxFailedTestShare) {
    toolErrors.push({
      code: 'TESTS_FAILED_TOO_MANY',
      message: `${failedText} (${percent(share)}, more than gate.maxFailedTestShare ${percent(gate.maxFailedTestShare)}); samples of a large part of the tests are missing, so the performance result is not trustworthy.`,
      hint: 'Fix the failing tests (run them without perf mode), or raise gate.maxFailedTestShare if the failures are expected.',
    });
  } else if (tests.unexpected > 0) {
    warnings.push({
      code: 'TESTS_FAILED',
      message: `${failedText}; their samples are counted and the performance result still decides.`,
      hint: 'Fix the failing tests in your regular test run: a test that fails early records fewer samples.',
    });
  }

  const stoppedByMaxFailures = maxFailures > 0 && tests.unexpected >= maxFailures;
  if (tests.status === 'timedout' || tests.status === 'interrupted' || stoppedByMaxFailures) {
    const why = stoppedByMaxFailures
      ? `it stopped after ${plural(tests.unexpected, 'failure')} (maxFailures ${maxFailures})`
      : tests.status === 'timedout'
        ? 'it timed out'
        : 'it was interrupted';
    toolErrors.push({
      code: 'RUN_INCOMPLETE',
      message: `The run did not execute all tests: ${why}. The evaluation covers only the samples collected.`,
      hint: 'Raise the global timeout or maxFailures for perf runs, or measure a smaller subset of tests.',
    });
  }

  if (sharded) {
    toolErrors.push({
      code: 'RUN_SHARDED',
      message:
        'The perf-mode run is sharded (--shard): each machine would evaluate only part of the keys.',
      hint: 'Run perf mode on one machine without --shard.',
    });
  }
  return { warnings, toolErrors };
}

/**
 * Outcome file of the run (02-REQ-26, 09-REQ-25): exit code 3 for tool errors, 2 for a blocking
 * evaluation in test mode with the gate enabled, otherwise 0. Code 1 is never computed.
 */
export function buildOutcome(report: RunReport, paths: Outcome['paths']): Outcome {
  const exitCode: Outcome['exitCode'] =
    report.toolErrors.length > 0
      ? 3
      : report.mode === 'test' &&
          report.evaluation.gateEnabled &&
          report.evaluation.status === 'failed'
        ? 2
        : 0;
  return {
    schemaVersion: SCHEMA_VERSIONS.outcome,
    runId: report.runId,
    mode: report.mode,
    exitCode,
    tests: { status: report.tests.status },
    evaluation: { status: report.evaluation.status, gateEnabled: report.evaluation.gateEnabled },
    toolErrors: report.toolErrors.map((issue) => ({ ...issue })),
    paths: { ...paths, thresholds: [...paths.thresholds] },
  };
}
