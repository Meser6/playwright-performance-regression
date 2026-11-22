// Time estimates: of a check (04-REQ-51, T = R × (S + N × m)) and of the start banner
// (04-REQ-66, N × P × m).
import type { RunReport } from '../types/index.ts';

/** `< 1 min`, `N min`, `H h M min` with minutes rounded up (04-REQ-51). */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return '< 1 min';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${String(minutes)} min`;
  return `${String(Math.floor(minutes / 60))} h ${String(minutes % 60)} min`;
}

export interface EstimateInput {
  /** Measured tests selected by the arguments. */
  tests: number;
  passesTest: number;
  passesThresholds: number;
  /** Mean duration of the measured tests that ran, in ms; null when none ran. */
  meanMs: number | null;
  /** Total duration of the dependency projects in this run, in ms; repeated in every pass. */
  setupMs: number;
}

/** The text after `Estimate: ` of a check (04-REQ-50 point 8, 04-REQ-51). */
export function estimateText(input: EstimateInput): string {
  const mean = input.meanMs;
  if (mean === null) return 'not available (no measured test ran)';
  const run = (passes: number): number => passes * (input.setupMs + input.tests * mean);
  const seconds = (Math.round(mean / 100) / 10).toFixed(1);
  return `measurement run ≈ ${formatDuration(run(input.passesTest))} (${String(input.tests)} tests × ${String(input.passesTest)} passes × ${seconds} s), thresholds run ≈ ${formatDuration(run(input.passesThresholds))} (× ${String(input.passesThresholds)} passes), 1 worker`;
}

/**
 * Time per test execution from an earlier run report (04-REQ-66): its wall time over the executed
 * tests (expected, unexpected and flaky); null when the report has none.
 */
export function msPerTest(
  report: Pick<RunReport, 'startedAt' | 'finishedAt' | 'tests'>,
): number | null {
  const executions = report.tests.expected + report.tests.unexpected + report.tests.flaky;
  const wall = Date.parse(report.finishedAt) - Date.parse(report.startedAt);
  if (executions <= 0 || !Number.isFinite(wall) || wall < 0) return null;
  return wall / executions;
}

/**
 * The Estimate value of the start banner (04-REQ-66, 04-D-51): from the last run, or "unknown"
 * without one. A time under a minute is "< 1 min" without "≈".
 */
export function startEstimate(input: {
  tests: number;
  passes: number;
  msPerTest: number | null;
}): string {
  if (input.msPerTest === null) return 'unknown (run PW_PERF_MODE=check for an estimate)';
  const time = formatDuration(input.tests * input.passes * input.msPerTest);
  return `${time.startsWith('<') ? '' : '≈ '}${time} (from the last run)`;
}
