// Argument parsing of the CLI (04, chapters 3 and 4.1): own options anywhere before "--", every
// other argument goes to `playwright test` unchanged. Pure (04, chapter 6).
import { resolveConfig } from '../core/config/index.ts';
import { CLI_COMMAND } from '../core/types/index.ts';
import type { CliIssue, Result } from '../core/types/index.ts';
import { ENV_LABEL_FORMAT, REPEAT_FORMAT, isEnvLabel, parseRepeat } from '../mode/index.ts';
import { isListOnly, testFilters, unsupportedOptions } from './playwright-args.ts';

export type HelpTopic = 'test' | 'thresholds' | 'report' | 'init';

export type ParsedCommand =
  | {
      kind: 'run';
      mode: 'test' | 'thresholds';
      env?: string;
      repeat?: number;
      prune: boolean;
      playwrightArgs: string[];
      listOnly: boolean;
    }
  | { kind: 'thresholds-from'; from: string; env?: string; prune: boolean; config?: string }
  | { kind: 'report'; input?: string; output?: string; config?: string }
  | { kind: 'init'; yes: boolean; dryRun: boolean }
  | { kind: 'help'; command?: HelpTopic }
  | { kind: 'version' };

export const COMMANDS: readonly HelpTopic[] = ['test', 'thresholds', 'report', 'init'];

const HELP = new Set(['--help', '-h']);
const VERSION = new Set(['--version', '-v']);
const USAGE_HINT = `Commands: ${COMMANDS.join(', ')}. Run "${CLI_COMMAND} --help" for the usage.`;

/** Own options of each command form (04, chapter 3). */
const RUN_OPTIONS = ['--env', '--repeat', '--prune', '--from'] as const;
const FROM_OPTIONS = ['--env', '--prune', '--from', '--config'] as const;
const REPORT_OPTIONS = ['--input', '--output', '--config'] as const;
/** Options that take a value. */
const VALUED: ReadonlySet<string> = new Set([
  '--env',
  '--repeat',
  '--from',
  '--config',
  '--input',
  '--output',
]);

interface OwnOption {
  name: string;
  value?: string;
}

/**
 * Own option at `args[i]` when its name is one of `names`: exact match only, so `--repeat-each`
 * is not `--repeat` (04-REQ-03). Returns the option and the number of arguments it takes.
 */
function ownOption(
  args: readonly string[],
  i: number,
  names: readonly string[],
  issues: CliIssue[],
): { option: OwnOption; used: number } | null {
  const arg = args[i] as string;
  const eq = arg.indexOf('=');
  const name = eq === -1 ? arg : arg.slice(0, eq);
  if (!names.includes(name)) return null;
  if (!VALUED.has(name)) {
    if (eq !== -1) {
      issues.push({
        code: 'CLI_INVALID_OPTION',
        message: `${name} takes no value, got "${arg}".`,
        hint: `Write ${name} on its own.`,
      });
    }
    return { option: { name }, used: 1 };
  }
  const next = args[i + 1];
  const value = eq !== -1 ? arg.slice(eq + 1) : next;
  if (value === undefined || value === '' || (eq === -1 && value.startsWith('-'))) {
    issues.push({
      code: 'CLI_MISSING_ARGUMENT',
      message: `${name} needs a value.`,
      hint: `Write ${name} <value> or ${name}=<value>.`,
    });
    return { option: { name }, used: eq === -1 && value === '' ? 2 : 1 };
  }
  return { option: { name, value }, used: eq !== -1 ? 1 : 2 };
}

function invalidValue(name: string, expected: string, value: string): CliIssue {
  return {
    code: 'CLI_INVALID_OPTION',
    message: `${name}: expected ${expected}, got ${JSON.stringify(value)}.`,
    hint: `Fix the value of ${name}.`,
  };
}

/** --env and --repeat are checked like PW_PERF_ENV and PW_PERF_REPEAT (04-REQ-06). */
function checkEnv(value: string, issues: CliIssue[]): string | undefined {
  if (isEnvLabel(value)) return value;
  issues.push(invalidValue('--env', ENV_LABEL_FORMAT, value));
  return undefined;
}

function checkRepeat(
  value: string,
  mode: 'test' | 'thresholds',
  issues: CliIssue[],
): number | undefined {
  const repeat = parseRepeat(value);
  if (repeat === null) {
    issues.push(invalidValue('--repeat', REPEAT_FORMAT, value));
    return undefined;
  }
  // The upper bound of run.repeat.* in the config schema.
  const resolved = resolveConfig(undefined, { mode, repeat });
  if (!resolved.ok) {
    const reason = resolved.issues[0]?.message ?? 'out of range';
    issues.push({
      code: 'CLI_INVALID_OPTION',
      message: `--repeat: ${reason}.`,
      hint: 'Fix the value of --repeat.',
    });
    return undefined;
  }
  return repeat;
}

function fail(issues: CliIssue[]): Result<ParsedCommand, CliIssue> {
  return { ok: false, issues };
}

function parseRun(
  mode: 'test' | 'thresholds',
  args: readonly string[],
): Result<ParsedCommand, CliIssue> {
  const sep = args.indexOf('--');
  const before = sep === -1 ? args : args.slice(0, sep);
  const after = sep === -1 ? [] : args.slice(sep + 1);
  if (before.some((a) => HELP.has(a))) return { ok: true, value: { kind: 'help', command: mode } };
  if (mode === 'thresholds' && before.some((a) => a === '--from' || a.startsWith('--from='))) {
    return parseFrom(before, after);
  }

  const issues: CliIssue[] = [];
  const playwrightArgs: string[] = [];
  let env: string | undefined;
  let repeat: number | undefined;
  let prune = false;
  for (let i = 0; i < before.length;) {
    const own = ownOption(before, i, RUN_OPTIONS, issues);
    if (own === null) {
      playwrightArgs.push(before[i] as string);
      i += 1;
      continue;
    }
    i += own.used;
    const { name, value } = own.option;
    if (mode === 'test' && (name === '--prune' || name === '--from')) {
      issues.push({
        code: 'CLI_INVALID_OPTION',
        message: `${name} is an option of the thresholds command, not of test.`,
        hint:
          name === '--from'
            ? `Derive thresholds from a report with "${CLI_COMMAND} thresholds --from <report.json>".`
            : `Remove ${name}, or run "${CLI_COMMAND} thresholds --prune".`,
      });
      continue;
    }
    if (name === '--prune') prune = true;
    else if (value === undefined) continue;
    else if (name === '--env') env = checkEnv(value, issues);
    else if (name === '--repeat') repeat = checkRepeat(value, mode, issues);
  }
  playwrightArgs.push(...after);

  const unsupported = unsupportedOptions(playwrightArgs);
  if (unsupported.length > 0) {
    issues.push({
      code: 'CLI_UNSUPPORTED_PLAYWRIGHT_OPTION',
      message: `${[...new Set(unsupported)].join(', ')} cannot be used in perf mode: ${unsupported.includes('--shard') ? 'each shard would see only part of the samples' : 'it changes how the tests run and their timings'}.`,
      hint: 'Remove the option; use "npx playwright test" for UI mode, debugging and sharding.',
    });
  }
  if (prune) {
    const filters = testFilters(playwrightArgs);
    if (filters.length > 0) {
      issues.push({
        code: 'CLI_PRUNE_WITH_FILTER',
        message: `--prune cannot be used with a test filter (${filters.join(' ')}): entries of the tests left out would be removed from the thresholds files.`,
        hint: 'Run --prune without --grep, --project or file paths, or leave --prune out.',
      });
    }
  }
  if (issues.length > 0) return fail(issues);
  return {
    ok: true,
    value: {
      kind: 'run',
      mode,
      ...(env === undefined ? {} : { env }),
      ...(repeat === undefined ? {} : { repeat }),
      prune,
      playwrightArgs,
      listOnly: isListOnly(playwrightArgs),
    },
  };
}

/** `thresholds --from <report.json>`: no Playwright arguments and no --repeat (04-REQ-08). */
function parseFrom(
  before: readonly string[],
  after: readonly string[],
): Result<ParsedCommand, CliIssue> {
  const issues: CliIssue[] = [];
  const rejected: string[] = [];
  let from: string | undefined;
  let env: string | undefined;
  let config: string | undefined;
  let prune = false;
  for (let i = 0; i < before.length;) {
    const own = ownOption(before, i, FROM_OPTIONS, issues);
    if (own === null) {
      const arg = before[i] as string;
      const name = arg.split('=')[0] as string;
      if (REPORT_OPTIONS.includes(name as (typeof REPORT_OPTIONS)[number])) {
        issues.push({
          code: 'CLI_INVALID_OPTION',
          message: `${name} is an option of the report command, not of thresholds --from.`,
          hint: `Remove ${name}.`,
        });
        // Skip the value of `--input <file>`.
        if (!arg.includes('=') && before[i + 1] !== undefined) i += 1;
      } else {
        rejected.push(arg);
      }
      i += 1;
      continue;
    }
    i += own.used;
    const { name, value } = own.option;
    if (name === '--prune') prune = true;
    else if (value === undefined) continue;
    else if (name === '--from') from = value;
    else if (name === '--env') env = checkEnv(value, issues);
    else if (name === '--config') config = value;
  }
  rejected.push(...after);
  if (rejected.length > 0) {
    issues.push({
      code: 'CLI_FROM_WITH_PLAYWRIGHT_ARGS',
      message: `thresholds --from runs no tests, so it takes no Playwright arguments and no --repeat; got: ${rejected.join(' ')}.`,
      hint: `Use only --from, --env, --prune and --config, or run "${CLI_COMMAND} thresholds" without --from to run the tests.`,
    });
  }
  if (issues.length > 0 || from === undefined) return fail(issues);
  return {
    ok: true,
    value: {
      kind: 'thresholds-from',
      from,
      ...(env === undefined ? {} : { env }),
      prune,
      ...(config === undefined ? {} : { config }),
    },
  };
}

function unexpected(command: string, arg: string): CliIssue {
  return {
    code: 'CLI_INVALID_OPTION',
    message: `${command} does not take "${arg}".`,
    hint: `Run "${CLI_COMMAND} ${command} --help" for its options.`,
  };
}

function parseReport(args: readonly string[]): Result<ParsedCommand, CliIssue> {
  if (args.some((a) => HELP.has(a)))
    return { ok: true, value: { kind: 'help', command: 'report' } };
  const issues: CliIssue[] = [];
  const found: Record<string, string> = {};
  for (let i = 0; i < args.length;) {
    const own = ownOption(args, i, REPORT_OPTIONS, issues);
    if (own === null) {
      issues.push(unexpected('report', args[i] as string));
      i += 1;
      continue;
    }
    i += own.used;
    if (own.option.value !== undefined) found[own.option.name] = own.option.value;
  }
  if (issues.length > 0) return fail(issues);
  const { '--input': input, '--output': output, '--config': config } = found;
  return {
    ok: true,
    value: {
      kind: 'report',
      ...(input === undefined ? {} : { input }),
      ...(output === undefined ? {} : { output }),
      ...(config === undefined ? {} : { config }),
    },
  };
}

function parseInit(args: readonly string[]): Result<ParsedCommand, CliIssue> {
  if (args.some((a) => HELP.has(a))) return { ok: true, value: { kind: 'help', command: 'init' } };
  const issues: CliIssue[] = [];
  let yes = false;
  let dryRun = false;
  for (const arg of args) {
    if (arg === '--yes' || arg === '-y') yes = true;
    else if (arg === '--dry-run') dryRun = true;
    else issues.push(unexpected('init', arg));
  }
  return issues.length > 0 ? fail(issues) : { ok: true, value: { kind: 'init', yes, dryRun } };
}

/** Parses the arguments after the command name (`process.argv.slice(2)`). */
export function parseArgs(argv: readonly string[]): Result<ParsedCommand, CliIssue> {
  const first = argv[0];
  if (first === undefined) {
    return fail([{ code: 'CLI_UNKNOWN_COMMAND', message: 'No command given.', hint: USAGE_HINT }]);
  }
  if (HELP.has(first)) return { ok: true, value: { kind: 'help' } };
  if (VERSION.has(first)) return { ok: true, value: { kind: 'version' } };
  const rest = argv.slice(1);
  switch (first) {
    case 'test':
    case 'thresholds':
      return parseRun(first, rest);
    case 'report':
      return parseReport(rest);
    case 'init':
      return parseInit(rest);
    default:
      return fail([
        { code: 'CLI_UNKNOWN_COMMAND', message: `Unknown command "${first}".`, hint: USAGE_HINT },
      ]);
  }
}
