// Time estimate of a check (04-REQ-51): T = S + N × R × m.

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
  repeatTest: number;
  repeatThresholds: number;
  /** Mean duration of the measured tests that ran, in ms; null when none ran. */
  meanMs: number | null;
  /** Total duration of the dependency projects in this run, in ms. */
  setupMs: number;
}

/** The text after `Estimate: ` (04-REQ-50 point 8, 04-REQ-51). */
export function estimateText(input: EstimateInput): string {
  const mean = input.meanMs;
  if (mean === null) return 'not available (no measured test ran)';
  const run = (repeat: number): number => input.setupMs + input.tests * repeat * mean;
  const seconds = (Math.round(mean / 100) / 10).toFixed(1);
  return `measurement run ≈ ${formatDuration(run(input.repeatTest))} (${String(input.tests)} tests × ${String(input.repeatTest)} repeats × ${seconds} s), thresholds run ≈ ${formatDuration(run(input.repeatThresholds))} (× ${String(input.repeatThresholds)} repeats), 1 worker`;
}
