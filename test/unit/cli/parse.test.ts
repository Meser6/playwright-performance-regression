import { describe, expect, test } from 'vitest';
import { parseArgs } from '../../../src/cli/parse.ts';
import type { ParsedCommand } from '../../../src/cli/parse.ts';
import {
  isListOnly,
  playwrightConfigArg,
  scanPlaywrightArgs,
  testFilters,
} from '../../../src/mode/playwright-args.ts';

function parsed(argv: string[]): ParsedCommand {
  const result = parseArgs(argv);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}

function codes(argv: string[]): string[] {
  const result = parseArgs(argv);
  if (result.ok) throw new Error(`expected issues for ${argv.join(' ')}`);
  return result.issues.map((i) => i.code);
}

const run = (
  mode: 'test' | 'thresholds',
  playwrightArgs: string[],
  extra: Partial<Extract<ParsedCommand, { kind: 'run' }>> = {},
): ParsedCommand => ({
  kind: 'run',
  mode,
  prune: false,
  playwrightArgs,
  listOnly: false,
  ...extra,
});

describe('parseArgs', () => {
  test.each<[string[], ParsedCommand]>([
    [
      ['test', '--grep', '@perf', 'tests/cart.spec.ts'],
      run('test', ['--grep', '@perf', 'tests/cart.spec.ts']),
    ],
    [['test', '--', '--repeat', '3'], run('test', ['--repeat', '3'])],
    [['test', '--repeat=3', '--repeat-each=2'], run('test', ['--repeat-each=2'], { repeat: 3 })],
    [['test', '-c', 'e2e/playwright.config.ts'], run('test', ['-c', 'e2e/playwright.config.ts'])],
    [['test', '--reporter=html'], run('test', ['--reporter=html'])],
    [
      ['test', '--reporter=line', '--reporter', 'dot'],
      run('test', ['--reporter=line', '--reporter', 'dot']),
    ],
    [['test', '--list'], run('test', ['--list'], { listOnly: true })],
    [
      ['test', '-c', 'apps/web/playwright.config.ts'],
      run('test', ['-c', 'apps/web/playwright.config.ts']),
    ],
    [
      ['thresholds', '--headed', '--env', 'staging', '--project', 'chromium', '--repeat', '7'],
      run('thresholds', ['--headed', '--project', 'chromium'], { env: 'staging', repeat: 7 }),
    ],
    [['thresholds', '--prune'], run('thresholds', [], { prune: true })],
    [
      ['thresholds', '--env=qa', '--', '--env', 'x'],
      run('thresholds', ['--env', 'x'], { env: 'qa' }),
    ],
  ])('04-AC-01 %j', (argv, expected) => {
    expect(parsed(argv)).toEqual(expected);
  });

  test('04-AC-01 thresholds --from takes --env, --prune and --config anywhere', () => {
    expect(
      parsed(['thresholds', '--prune', '--from', 'r.json', '--config=pw.json', '--env', 'qa']),
    ).toEqual({
      kind: 'thresholds-from',
      from: 'r.json',
      env: 'qa',
      prune: true,
      config: 'pw.json',
    });
    expect(parsed(['thresholds', '--from=r.json'])).toEqual({
      kind: 'thresholds-from',
      from: 'r.json',
      prune: false,
    });
  });

  test('04-AC-01 report, init, help and version', () => {
    expect(
      parsed(['report', '--input', 'a/report.json', '--output=b.html', '--config', 'c.ts']),
    ).toEqual({
      kind: 'report',
      input: 'a/report.json',
      output: 'b.html',
      config: 'c.ts',
    });
    expect(parsed(['report'])).toEqual({ kind: 'report' });
    expect(parsed(['init', '-y', '--dry-run'])).toEqual({ kind: 'init', yes: true, dryRun: true });
    expect(parsed(['--help'])).toEqual({ kind: 'help' });
    expect(parsed(['-h'])).toEqual({ kind: 'help' });
    expect(parsed(['test', '--grep', 'x', '-h'])).toEqual({ kind: 'help', command: 'test' });
    expect(parsed(['thresholds', '--help'])).toEqual({ kind: 'help', command: 'thresholds' });
    expect(parsed(['report', '--help'])).toEqual({ kind: 'help', command: 'report' });
    expect(parsed(['--version'])).toEqual({ kind: 'version' });
    expect(parsed(['-v'])).toEqual({ kind: 'version' });
    // After "--" even --help goes to Playwright.
    expect(parsed(['test', '--', '--help'])).toEqual(run('test', ['--help']));
  });

  test('04-REQ-01 a missing or unknown command is CLI_UNKNOWN_COMMAND with the list of commands', () => {
    for (const argv of [[], ['tests'], ['--grep', 'x']]) {
      const result = parseArgs(argv);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.issues[0]?.code).toBe('CLI_UNKNOWN_COMMAND');
      expect(result.issues[0]?.hint).toContain('test, thresholds, report, init');
    }
  });

  test('04-REQ-02 --prune and --from in test are CLI_INVALID_OPTION', () => {
    expect(codes(['test', '--from', 'report.json'])).toEqual(['CLI_INVALID_OPTION']);
    expect(codes(['test', '--prune'])).toEqual(['CLI_INVALID_OPTION']);
  });

  test('04-REQ-03 own options match exactly; a missing value is CLI_MISSING_ARGUMENT', () => {
    expect(parsed(['test', '--envx', 'a', '--repeat-each', '2'])).toEqual(
      run('test', ['--envx', 'a', '--repeat-each', '2']),
    );
    expect(codes(['test', '--env'])).toEqual(['CLI_MISSING_ARGUMENT']);
    expect(codes(['test', '--repeat', '--headed'])).toEqual(['CLI_MISSING_ARGUMENT']);
    expect(codes(['test', '--env='])).toEqual(['CLI_MISSING_ARGUMENT']);
    expect(codes(['thresholds', '--from'])).toEqual(['CLI_MISSING_ARGUMENT']);
    expect(codes(['report', '--input'])).toEqual(['CLI_MISSING_ARGUMENT']);
    expect(codes(['thresholds', '--prune=yes'])).toEqual(['CLI_INVALID_OPTION']);
  });

  test('04-REQ-06 --repeat and --env are validated like the environment variables', () => {
    const issues = (argv: string[]): { code: string; message: string }[] => {
      const result = parseArgs(argv);
      if (result.ok) throw new Error('expected issues');
      return result.issues;
    };
    expect(issues(['test', '--repeat', '0'])).toEqual([
      expect.objectContaining({
        code: 'CLI_INVALID_OPTION',
        message: '--repeat: expected an integer >= 1, like "5", got "0".',
      }),
    ]);
    expect(issues(['test', '--repeat', '1001'])[0]?.message).toContain('from 1 to 1000');
    expect(issues(['test', '--env', 'QA'])[0]?.message).toContain('--env: expected a label');
    expect(codes(['thresholds', '--from', 'r.json', '--env', 'Bad!'])).toEqual([
      'CLI_INVALID_OPTION',
    ]);
    expect(parsed(['test', '--repeat', '1000'])).toMatchObject({ repeat: 1000 });
  });

  test('04-REQ-07 --ui, --debug and --shard are CLI_UNSUPPORTED_PLAYWRIGHT_OPTION, also with =value', () => {
    for (const args of [
      ['--ui'],
      ['--debug'],
      ['--shard=1/4'],
      ['--ui-port=0'],
      ['--ui-host', 'x'],
    ]) {
      expect(codes(['test', ...args]), args.join(' ')).toEqual([
        'CLI_UNSUPPORTED_PLAYWRIGHT_OPTION',
      ]);
    }
    expect(codes(['test', '--shard', '1/4'])).toEqual(['CLI_UNSUPPORTED_PLAYWRIGHT_OPTION']);
    expect(codes(['test', '--', '--debug'])).toEqual(['CLI_UNSUPPORTED_PLAYWRIGHT_OPTION']);
    // A value of another option is not an option.
    expect(parsed(['test', '--grep', '--ui'])).toEqual(run('test', ['--grep', '--ui']));
  });

  test('04-REQ-08 thresholds --from with Playwright arguments or --repeat is CLI_FROM_WITH_PLAYWRIGHT_ARGS', () => {
    expect(codes(['thresholds', '--from', 'r.json', '--grep', 'x'])).toEqual([
      'CLI_FROM_WITH_PLAYWRIGHT_ARGS',
    ]);
    expect(codes(['thresholds', '--repeat', '3', '--from', 'r.json'])).toEqual([
      'CLI_FROM_WITH_PLAYWRIGHT_ARGS',
    ]);
    expect(codes(['thresholds', '--from', 'r.json', '--', 'x'])).toEqual([
      'CLI_FROM_WITH_PLAYWRIGHT_ARGS',
    ]);
    expect(codes(['thresholds', '--from', 'r.json', '--input', 'x'])).toEqual([
      'CLI_INVALID_OPTION',
    ]);
    expect(codes(['report', '--env', 'qa'])).toContain('CLI_INVALID_OPTION');
    expect(codes(['report', 'report.json'])).toEqual(['CLI_INVALID_OPTION']);
    expect(codes(['init', '--force'])).toEqual(['CLI_INVALID_OPTION']);
  });

  test('04-AC-23 init --lang takes one of the wizard languages; an unknown code lists the codes', () => {
    expect(parsed(['init', '--lang', 'pl'])).toEqual({
      kind: 'init',
      yes: false,
      dryRun: false,
      lang: 'pl',
    });
    expect(parsed(['init', '--yes', '--lang=uk'])).toEqual({
      kind: 'init',
      yes: true,
      dryRun: false,
      lang: 'uk',
    });
    const result = parseArgs(['init', '--lang', 'xx']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code)).toEqual(['CLI_INVALID_OPTION']);
    expect(result.issues[0]?.message).toContain('"xx"');
    expect(result.issues[0]?.message).toContain('en, es, fr, pl, it, uk, ru');
    expect(codes(['init', '--lang'])).toEqual(['CLI_MISSING_ARGUMENT']);
  });

  test('04-AC-14 thresholds --prune with --grep, --project or a file path is CLI_PRUNE_WITH_FILTER', () => {
    for (const filter of [
      ['--grep', '@cart'],
      ['-g', '@cart'],
      ['--grep-invert=@slow'],
      ['--project', 'chromium'],
      ['--project=chromium'],
      ['tests/cart.spec.ts'],
      ['--last-failed'],
      ['--only-changed'],
    ]) {
      const result = parseArgs(['thresholds', '--prune', ...filter]);
      expect(result.ok, filter.join(' ')).toBe(false);
      if (result.ok) continue;
      expect(result.issues.map((i) => i.code)).toEqual(['CLI_PRUNE_WITH_FILTER']);
      expect(result.issues[0]?.message).toContain(filter.join(' '));
    }
    // Options that do not select tests are fine.
    expect(
      parsed(['thresholds', '--prune', '--headed', '--workers', '2', '--reporter', 'dot']),
    ).toMatchObject({
      prune: true,
    });
  });
});

describe('Playwright arguments', () => {
  test('options with values, optional values, variadic --project and short forms', () => {
    expect(
      scanPlaywrightArgs([
        '-c',
        'a.ts',
        '--grep=x',
        '-gy',
        'f1',
        '--project',
        'p1',
        'p2',
        '-x',
        'f2',
      ]),
    ).toEqual({
      options: [
        { name: '--config', values: ['a.ts'], index: 0, inline: false },
        { name: '--grep', values: ['x'], index: 2, inline: true },
        { name: '--grep', values: ['y'], index: 3, inline: true },
        { name: '--project', values: ['p1', 'p2'], index: 5, inline: false },
        { name: '-x', values: [], index: 8, inline: false },
      ],
      positionals: ['f1', 'f2'],
    });
    expect(
      scanPlaywrightArgs(['--only-changed', 'main', '--only-changed', '--headed']).positionals,
    ).toEqual([]);
    expect(scanPlaywrightArgs(['-u', 'tests/a.spec.ts']).options[0]?.values).toEqual([
      'tests/a.spec.ts',
    ]);
  });

  test('04-REQ-20 test filters: --grep, -g, --project and file paths; values of other options are no paths', () => {
    expect(testFilters(['--workers', '2', '--reporter', 'dot', '--output', 'out'])).toEqual([]);
    expect(testFilters(['--headed', 'cart'])).toEqual(['cart']);
    expect(testFilters(['-g', '@perf', '--project=a'])).toEqual(['-g @perf', '--project=a']);
  });

  test('--list and the -c directory', () => {
    expect(isListOnly(['--list'])).toBe(true);
    expect(isListOnly(['--grep', '--list'])).toBe(false);
    expect(playwrightConfigArg(['-c', 'a.ts', '--config=b.ts'])).toBe('b.ts');
    expect(playwrightConfigArg(['-capps/web'])).toBe('apps/web');
    expect(playwrightConfigArg(['--grep', 'x'])).toBeNull();
  });
});
