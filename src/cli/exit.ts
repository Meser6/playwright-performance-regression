// Exit code of the commands that run tests (04-REQ-22, 04-REQ-23; 00, chapter 11). Pure.
import { INIT_COMMAND } from '../core/types/index.ts';
import type { CliIssue, Outcome } from '../core/types/index.ts';

export interface ExitInput {
  outcome:
    { ok: true; value: Outcome } | { ok: false; reason: 'missing' | 'invalid'; detail?: string };
  /** Exit code of the Playwright process; null when it ended by a signal. */
  childExitCode: number | null;
  /** Signal the CLI itself received (04-D-10). */
  receivedSignal?: 'SIGINT' | 'SIGTERM';
  listOnly: boolean;
}

export const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 } as const;

/**
 * 130/143 after a signal the CLI received, whatever the outcome file says; the Playwright code
 * with --list; else the code from the outcome file, or 3 with a diagnosis without a valid one.
 */
export function resolveExitCode(input: ExitInput): { code: number; issues: CliIssue[] } {
  if (input.receivedSignal !== undefined) {
    return { code: SIGNAL_EXIT_CODES[input.receivedSignal], issues: [] };
  }
  if (input.listOnly) return { code: input.childExitCode ?? 1, issues: [] };
  if (input.outcome.ok) return { code: input.outcome.value.exitCode, issues: [] };
  const playwright =
    input.childExitCode === null
      ? 'Playwright ended without an exit code (killed by a signal)'
      : `Playwright exited with code ${input.childExitCode}`;
  if (input.outcome.reason === 'invalid') {
    return {
      code: 3,
      issues: [
        {
          code: 'CLI_OUTCOME_INVALID',
          message: `The outcome file of the run is not valid${input.outcome.detail === undefined ? '' : `: ${input.outcome.detail}`}. ${playwright}.`,
          hint: 'Check that the project uses one version of playwright-performance-regression, then run again.',
        },
      ],
    };
  }
  return {
    code: 3,
    issues: [
      {
        code: 'CLI_OUTCOME_MISSING',
        message: `The run wrote no outcome file, so its result is unknown. ${playwright}.`,
        hint: [
          'Common causes:',
          `- playwright.config does not use withPerf() (set it up with "${INIT_COMMAND}");`,
          '- a configuration error (see the message above);',
          '- no test matched the filters (Playwright then reports no tests);',
          '- Playwright stopped before the reporters finished (onEnd).',
        ].join('\n'),
      },
    ],
  };
}
