import { describe, expect, test } from 'vitest';
import { parseArgs } from '../../../src/cli/parse.ts';
import { scanPlaywrightArgs, testFilters } from '../../../src/mode/playwright-args.ts';

describe('parseArgs', () => {
  test('04-AC-01 no arguments runs the wizard', () => {
    expect(parseArgs([])).toEqual({ ok: true, value: { kind: 'init' } });
  });

  test.each([
    ['test'],
    ['thresholds', '--from', 'r.json'],
    ['init', '--yes'],
    ['--help'],
    ['--version'],
    ['report'],
  ])('04-AC-01 04-REQ-01 %j is CLI_UNKNOWN_COMMAND with the environment form', (...argv) => {
    const result = parseArgs(argv);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    const [issue] = result.issues;
    expect(issue?.code).toBe('CLI_UNKNOWN_COMMAND');
    expect(issue?.message).toContain(`got "${argv.join(' ')}"`);
    expect(issue?.hint).toContain('PW_PERF_MODE=test <your test command>');
    expect(issue?.hint).toContain('PW_PERF_LANG, PW_PERF_DRY_RUN and PW_PERF_NO_TUTORIAL');
    // 04-REQ-70: no runner commands or options in the hint.
    expect(issue?.hint).not.toMatch(/npx pw-perf|--yes|--lang/u);
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

  test('04-REQ-35 test filters: --grep, -g, --project and file paths; values of other options are no paths', () => {
    expect(testFilters(['--workers', '2', '--reporter', 'dot', '--output', 'out'])).toEqual([]);
    expect(testFilters(['--headed', 'cart'])).toEqual(['cart']);
    expect(testFilters(['-g', '@perf', '--project=a'])).toEqual(['-g @perf', '--project=a']);
  });
});
