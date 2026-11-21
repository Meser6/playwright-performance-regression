// Arguments of the binary (04-REQ-01, D-43): the package has no commands and no options. Without
// arguments the binary runs the wizard; any argument is CLI_UNKNOWN_COMMAND. Pure (04, chapter 6).
import { INIT_COMMAND } from '../core/types/index.ts';
import type { CliIssue, Result } from '../core/types/index.ts';

export type ParsedCommand = { kind: 'init' };

/** The message and hint for arguments given to the binary or to the create package. */
export function noArgumentsIssue(args: readonly string[]): CliIssue {
  return {
    code: 'CLI_UNKNOWN_COMMAND',
    message: `The package has no commands or options, got "${args.join(' ')}".`,
    hint: [
      'Run your test command with PW_PERF_MODE, e.g. PW_PERF_MODE=test <your test command>',
      '(test, thresholds or check). Set up with ' +
        `${INIT_COMMAND}; its variables are PW_PERF_LANG, PW_PERF_DRY_RUN and PW_PERF_NO_TUTORIAL.`,
    ].join('\n'),
  };
}

/** Parses the arguments after the command name (`process.argv.slice(2)`). */
export function parseArgs(argv: readonly string[]): Result<ParsedCommand, CliIssue> {
  if (argv.length === 0) return { ok: true, value: { kind: 'init' } };
  return { ok: false, issues: [noArgumentsIssue(argv)] };
}
