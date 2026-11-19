// Messages of the CLI (04-REQ-30, 04-REQ-31): on stderr, in English, each line prefixed with the
// package name; errors and warnings with their code and a hint. Colors by the rules of
// 04-REQ-44 (colorEnabled). Pure.
import { colorEnabled, paint as paintText } from '../console/color.ts';
import { PACKAGE_NAME } from '../core/types/index.ts';
import type { Issue, Outcome } from '../core/types/index.ts';

export const PREFIX = `${PACKAGE_NAME}: `;

export interface OutputStyle {
  color: boolean;
}

/** The output style of `stream` (04-REQ-44). */
export function outputStyle(
  stream: { isTTY?: boolean | undefined },
  env: Readonly<Record<string, string | undefined>>,
): OutputStyle {
  return { color: colorEnabled(stream, env) };
}

function paint(text: string, style: 'red' | 'yellow' | 'green', opts: OutputStyle): string {
  return paintText(text, style, opts.color);
}

/** One informational line. */
export function infoLine(text: string): string {
  return `${PREFIX}${text}\n`;
}

/** An error or warning: code, message, then the hint lines indented. */
export function formatIssue(issue: Issue, level: 'error' | 'warning', opts: OutputStyle): string {
  const label = paint(`${level} ${issue.code}`, level === 'error' ? 'red' : 'yellow', opts);
  const lines = [`${PREFIX}${label}: ${issue.message}`];
  if (issue.hint !== undefined) {
    for (const line of issue.hint.split('\n')) lines.push(`  ${line}`);
  }
  return `${lines.join('\n')}\n`;
}

export function formatIssues(
  issues: readonly Issue[],
  level: 'error' | 'warning',
  opts: OutputStyle,
): string {
  return issues.map((issue) => formatIssue(issue, level, opts)).join('');
}

const TESTS_TEXT: Record<Outcome['tests']['status'], string> = {
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

/**
 * At most three lines after a run (04-REQ-30): the result, the report and, in thresholds mode,
 * the thresholds diff. Paths are shown as given.
 */
export function resultLines(outcome: Outcome | null, exitCode: number, opts: OutputStyle): string {
  const parts: string[] = [];
  if (outcome !== null) {
    parts.push(TESTS_TEXT[outcome.tests.status]);
    parts.push(
      outcome.mode === 'thresholds'
        ? outcome.exitCode === 0
          ? 'thresholds derived'
          : 'thresholds not written'
        : EVALUATION_TEXT[outcome.evaluation.status],
    );
  }
  const code = paint(`exit code ${exitCode}`, exitCode === 0 ? 'green' : 'red', opts);
  parts.push(code);
  let text = infoLine(parts.join(' · '));
  const report = outcome?.paths.reportHtml ?? outcome?.paths.reportJson ?? null;
  if (report !== null) text += infoLine(`report: ${report}`);
  const diff = outcome?.paths.thresholdsDiff ?? null;
  if (diff !== null) text += infoLine(`thresholds diff: ${diff}`);
  return text;
}
