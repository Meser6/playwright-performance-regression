// Texts of the result of a run, shared by the CLI line (04-REQ-30) and the Outcome line of the
// reporter in the environment mode (04-REQ-62).
import type { Outcome } from '../core/types/index.ts';
import { painter } from './color.ts';

export const TESTS_TEXT: Record<Outcome['tests']['status'], string> = {
  passed: 'tests passed',
  failed: 'tests failed',
  timedout: 'tests timed out',
  interrupted: 'tests interrupted',
};

const EVALUATION_TEXT: Record<Outcome['evaluation']['status'], string> = {
  passed: 'performance passed',
  warned: 'performance passed with warnings',
  failed: 'performance failed',
  error: 'performance not evaluated',
};

/** The performance part of the result line (04-REQ-30). */
export function performanceText(outcome: Outcome): string {
  if (outcome.mode === 'thresholds') {
    return outcome.exitCode === 0 ? 'thresholds derived' : 'thresholds not written';
  }
  // Exit code 3 with an evaluation: the result is not trustworthy (e.g. TESTS_FAILED_TOO_MANY),
  // so the evaluation does not decide (09-REQ-25).
  if (outcome.exitCode === 3 && outcome.evaluation.status !== 'error') {
    return 'performance result not trustworthy';
  }
  return EVALUATION_TEXT[outcome.evaluation.status];
}

/**
 * `Outcome: performance failed · exit code 2 in <path> (Playwright exits with 1)` (04-REQ-62):
 * the exact exit code of the package next to the exit code Playwright ends with.
 */
export function outcomeLine(outcome: Outcome, path: string): string {
  const playwright = outcome.tests.status === 'passed' && outcome.exitCode === 0 ? 0 : 1;
  return `Outcome: ${performanceText(outcome)} · exit code ${String(outcome.exitCode)} in ${path} (Playwright exits with ${String(playwright)})\n`;
}

/** `Next: <text>` with `Next:` in bold (09-REQ-32). */
export function nextLine(text: string, color: boolean): string {
  return `${painter(color)('Next:', 'bold')} ${text}\n`;
}
