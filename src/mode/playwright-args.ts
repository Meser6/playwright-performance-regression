// Reading the arguments passed to `playwright test` (04, chapters 4.1, 4.3 and 4.9). The CLI never
// changes them except for the --reporter value (04-REQ-15); it only looks for the options that
// matter to perf mode. Pure.

/** Options of `playwright test` that take a value (`--name value` or `--name=value`). */
const WITH_VALUE: ReadonlySet<string> = new Set([
  '--browser',
  '--config',
  '--global-timeout',
  '--grep',
  '--grep-invert',
  '--max-failures',
  '--output',
  '--repeat-each',
  '--reporter',
  '--retries',
  '--shard',
  '--test-list',
  '--test-list-invert',
  '--timeout',
  '--trace',
  '--tsconfig',
  '--ui-host',
  '--ui-port',
  '--update-source-method',
  '--workers',
]);

/** Options whose value is optional: the next argument is the value unless it starts with "-". */
const OPTIONAL_VALUE: ReadonlySet<string> = new Set(['--only-changed', '--update-snapshots']);

/** Options that take every following argument up to the next option (`--project a b`). */
const VARIADIC: ReadonlySet<string> = new Set(['--project']);

/** Short aliases of `playwright test` (single letter after one dash). */
const SHORT: Readonly<Record<string, string>> = {
  c: '--config',
  g: '--grep',
  j: '--workers',
  u: '--update-snapshots',
  x: '-x',
  h: '--help',
};

/** One option found in the Playwright arguments. */
export interface PlaywrightOption {
  /** Long name, e.g. "--reporter"; "-x" for the short flag without a long form. */
  name: string;
  /** Value(s); empty for a flag. */
  values: string[];
  /** Index of the option argument in the list. */
  index: number;
  /** The value was written as `--name=value` (or `-cvalue`) in the same argument. */
  inline: boolean;
}

export interface ScannedArgs {
  options: PlaywrightOption[];
  /** Arguments that are no option or option value: test file filters. */
  positionals: string[];
}

function isOptionLike(arg: string): boolean {
  return arg.startsWith('-') && arg !== '-';
}

/**
 * Splits the Playwright arguments into options (with their values) and positional test filters.
 * Unknown options are taken as flags without a value.
 */
export function scanPlaywrightArgs(args: readonly string[]): ScannedArgs {
  const options: PlaywrightOption[] = [];
  const positionals: string[] = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i] as string;
    if (!isOptionLike(arg)) {
      positionals.push(arg);
      i += 1;
      continue;
    }
    let name: string;
    let inlineValue: string | undefined;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      name = eq === -1 ? arg : arg.slice(0, eq);
      if (eq !== -1) inlineValue = arg.slice(eq + 1);
    } else {
      const long = SHORT[arg.charAt(1)];
      name = long ?? arg;
      if (long !== undefined && arg.length > 2) {
        const rest = arg.slice(2);
        inlineValue = rest.startsWith('=') ? rest.slice(1) : rest;
      }
    }
    const option: PlaywrightOption = { name, values: [], index: i, inline: false };
    options.push(option);
    i += 1;
    if (inlineValue !== undefined) {
      option.values.push(inlineValue);
      option.inline = true;
      continue;
    }
    if (WITH_VALUE.has(name)) {
      if (i < args.length) {
        option.values.push(args[i] as string);
        i += 1;
      }
    } else if (OPTIONAL_VALUE.has(name)) {
      if (i < args.length && !isOptionLike(args[i] as string)) {
        option.values.push(args[i] as string);
        i += 1;
      }
    } else if (VARIADIC.has(name)) {
      while (i < args.length && !isOptionLike(args[i] as string)) {
        option.values.push(args[i] as string);
        i += 1;
      }
    }
  }
  return { options, positionals };
}

/** Options that select a subset of the tests (04-REQ-20, 04-REQ-35). */
const FILTERS: ReadonlySet<string> = new Set([
  '--grep',
  '--grep-invert',
  '--project',
  '--last-failed',
  '--only-changed',
  '--test-list',
  '--test-list-invert',
]);

/** Filter options and test file filters in the arguments, as written by the user. */
export function testFilters(args: readonly string[]): string[] {
  const scanned = scanPlaywrightArgs(args);
  return [
    ...scanned.options
      .filter((o) => FILTERS.has(o.name))
      .map((o) => args.slice(o.index, o.index + 1 + (o.inline ? 0 : o.values.length)).join(' ')),
    ...scanned.positionals,
  ];
}

/** Playwright options perf mode does not support (04-REQ-07): --ui (and its host/port), --debug, --shard. */
const UNSUPPORTED: ReadonlySet<string> = new Set([
  '--ui',
  '--ui-host',
  '--ui-port',
  '--debug',
  '--shard',
]);

export function unsupportedOptions(args: readonly string[]): string[] {
  return scanPlaywrightArgs(args)
    .options.filter((o) => UNSUPPORTED.has(o.name))
    .map((o) => o.name);
}

/** `--list`: Playwright only lists the tests (01-REQ-40, 04-REQ-22). */
export function isListOnly(args: readonly string[]): boolean {
  return scanPlaywrightArgs(args).options.some((o) => o.name === '--list');
}

/** Value of the last -c/--config, or null (04-REQ-13). */
export function playwrightConfigArg(args: readonly string[]): string | null {
  const configs = scanPlaywrightArgs(args).options.filter(
    (o) => o.name === '--config' && o.values.length > 0,
  );
  return configs.length === 0 ? null : (configs[configs.length - 1]?.values[0] ?? null);
}

/**
 * The arguments of `playwright test` in the main Playwright process: the words after `test` in
 * process.argv, including flags written in an npm script (04-REQ-61). Empty when there is no
 * `test` word (e.g. another Playwright command).
 */
export function testArgsFromArgv(argv: readonly string[]): string[] {
  const at = argv.findIndex((word, i) => i >= 1 && word === 'test');
  return at < 0 ? [] : argv.slice(at + 1);
}

/** Values of the last --reporter (04-REQ-61); null without --reporter. */
export function lastReporterValue(args: readonly string[]): string | null {
  const reporters = scanPlaywrightArgs(args).options.filter((o) => o.name === '--reporter');
  const last = reporters.at(-1);
  return last === undefined ? null : last.values.join(',');
}
