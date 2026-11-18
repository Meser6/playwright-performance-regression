import { describe, expect, expectTypeOf, test } from 'vitest';
import { ConfigError, DOCS_CONFIG_URL } from '../../../src/core/types/index.ts';
import type { Issue, Result } from '../../../src/core/types/index.ts';

describe('shared core types', () => {
  test('Result carries either a value or issues', () => {
    const ok: Result<number> = { ok: true, value: 1 };
    const failed: Result<number> = { ok: false, issues: [{ code: 'X', message: 'm' }] };
    expect(ok.ok && ok.value).toBe(1);
    expect(!failed.ok && failed.issues[0]?.code).toBe('X');
    expectTypeOf<Extract<Result<number>, { ok: false }>['issues']>().toEqualTypeOf<Issue[]>();
  });

  test('ConfigError lists every problem once, starting with its path (03-REQ-12)', () => {
    const error = new ConfigError([
      {
        code: 'CONFIG_UNKNOWN_OPTION',
        message: 'measure.exclud: unknown option. Did you mean "measure.exclude"?',
        path: 'measure.exclud',
        hint: 'Remove the option or fix its name.',
      },
      { code: 'MODE_INVALID_VALUE', message: 'PW_PERF_MODE: expected "test", got "x"' },
    ]);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ConfigError');
    expect(error.issues).toHaveLength(2);
    expect(error.message).toBe(
      [
        'playwright-performance-regression: invalid configuration (2 problems)',
        '  - measure.exclud: unknown option. Did you mean "measure.exclude"?',
        '    Remove the option or fix its name.',
        '  - PW_PERF_MODE: expected "test", got "x"',
        `See ${DOCS_CONFIG_URL} for all options.`,
      ].join('\n'),
    );
    expect(error.message.split('measure.exclud:')).toHaveLength(2);
    expect(new ConfigError([{ code: 'X', message: 'a: b' }]).message).toContain('(1 problem)');
  });
});
