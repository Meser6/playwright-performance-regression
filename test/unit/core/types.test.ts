import { describe, expect, expectTypeOf, test } from 'vitest';
import { ConfigError } from '../../../src/core/types/index.ts';
import type { Issue, Result } from '../../../src/core/types/index.ts';

describe('shared core types', () => {
  test('Result carries either a value or issues', () => {
    const ok: Result<number> = { ok: true, value: 1 };
    const failed: Result<number> = { ok: false, issues: [{ code: 'X', message: 'm' }] };
    expect(ok.ok && ok.value).toBe(1);
    expect(!failed.ok && failed.issues[0]?.code).toBe('X');
    expectTypeOf<Extract<Result<number>, { ok: false }>['issues']>().toEqualTypeOf<Issue[]>();
  });

  test('ConfigError lists every issue with its path and hint', () => {
    const error = new ConfigError([
      {
        code: 'CONFIG_UNKNOWN_OPTION',
        message: 'Unknown option.',
        path: 'run.x',
        hint: 'Remove it.',
      },
      { code: 'MODE_INVALID', message: 'Bad mode.' },
    ]);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ConfigError');
    expect(error.issues).toHaveLength(2);
    expect(error.message).toContain('- CONFIG_UNKNOWN_OPTION (run.x): Unknown option. Remove it.');
    expect(error.message).toContain('- MODE_INVALID: Bad mode.');
  });
});
