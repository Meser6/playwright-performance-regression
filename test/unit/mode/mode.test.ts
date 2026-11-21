import { describe, expect, test } from 'vitest';
import { MODE_ENV_NAMES, isCiEnv, readModeState, writeModeState } from '../../../src/mode/index.ts';
import type { PerfModeState } from '../../../src/mode/index.ts';

function issuesOf(env: Record<string, string | undefined>): { code: string; message: string }[] {
  const result = readModeState(env);
  if (result.ok) throw new Error('expected issues');
  return result.issues;
}

describe('readModeState', () => {
  test('perf mode is off without PW_PERF_MODE, whatever the other variables hold', () => {
    expect(readModeState({})).toEqual({ ok: true, value: null });
    expect(readModeState({ PW_PERF_MODE: '' })).toEqual({ ok: true, value: null });
    expect(readModeState({ PW_PERF_REPEAT: 'x', PW_PERF_ENV: 'QA!' })).toEqual({
      ok: true,
      value: null,
    });
  });

  test('reads every variable of the environment contract', () => {
    expect(
      readModeState({
        PW_PERF_MODE: 'thresholds',
        PW_PERF_REPEAT: '7',
        PW_PERF_ENV: 'staging-2',
        PW_PERF_RUN_ID: '2026-11-18T10-00-00-a1b2',
        PW_PERF_OUTCOME_FILE: '/tmp/x.outcome.json',
        PW_PERF_PRUNE: '1',
      }),
    ).toEqual({
      ok: true,
      value: {
        mode: 'thresholds',
        repeat: 7,
        env: 'staging-2',
        runId: '2026-11-18T10-00-00-a1b2',
        outcomeFile: '/tmp/x.outcome.json',
        prune: true,
      },
    });
    expect(readModeState({ PW_PERF_MODE: 'test' })).toEqual({ ok: true, value: { mode: 'test' } });
  });

  test('empty optional variables count as unset', () => {
    expect(
      readModeState({
        PW_PERF_MODE: 'test',
        PW_PERF_REPEAT: '',
        PW_PERF_ENV: '',
        PW_PERF_RUN_ID: '',
        PW_PERF_OUTCOME_FILE: '',
        PW_PERF_PRUNE: '',
      }),
    ).toEqual({ ok: true, value: { mode: 'test' } });
  });

  test('03-AC-03 MODE_INVALID_VALUE for an unknown PW_PERF_MODE is an error, not mode off', () => {
    const issues = issuesOf({ PW_PERF_MODE: 'tset' });
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'MODE_INVALID_VALUE',
        message: 'PW_PERF_MODE: expected "test", "thresholds" or "check", got "tset"',
      }),
    ]);
  });

  test('03-AC-03 MODE_INVALID_VALUE for PW_PERF_REPEAT, PW_PERF_ENV and PW_PERF_PRUNE, all at once', () => {
    const issues = issuesOf({
      PW_PERF_MODE: 'test',
      PW_PERF_REPEAT: '0',
      PW_PERF_ENV: 'QA',
      PW_PERF_PRUNE: 'yes',
    });
    expect(issues.map((i) => i.code)).toEqual([
      'MODE_INVALID_VALUE',
      'MODE_INVALID_VALUE',
      'MODE_INVALID_VALUE',
    ]);
    expect(issues[0]?.message).toBe('PW_PERF_REPEAT: expected an integer >= 1, like "5", got "0"');
    expect(issues[1]?.message).toBe(
      'PW_PERF_ENV: expected a label of lowercase letters, digits and "-" (at most 32 characters), like "staging", got "QA"',
    );
    expect(issues[2]?.message).toBe('PW_PERF_PRUNE: expected "1", got "yes"');
    for (const repeat of ['1.5', '-2', ' 3', '3e2', '05x']) {
      expect(issuesOf({ PW_PERF_MODE: 'test', PW_PERF_REPEAT: repeat })[0]?.code).toBe(
        'MODE_INVALID_VALUE',
      );
    }
    expect(issuesOf({ PW_PERF_MODE: 'test', PW_PERF_ENV: 'a'.repeat(33) })[0]?.code).toBe(
      'MODE_INVALID_VALUE',
    );
  });
});

describe('writeModeState', () => {
  test('writes only the variables of the given fields and reads back the same state', () => {
    const full: PerfModeState = {
      mode: 'thresholds',
      repeat: 3,
      env: 'qa',
      runId: 'r1',
      outcomeFile: '/tmp/o.json',
      prune: true,
    };
    expect(writeModeState(full)).toEqual({
      PW_PERF_MODE: 'thresholds',
      PW_PERF_REPEAT: '3',
      PW_PERF_ENV: 'qa',
      PW_PERF_RUN_ID: 'r1',
      PW_PERF_OUTCOME_FILE: '/tmp/o.json',
      PW_PERF_PRUNE: '1',
    });
    expect(readModeState(writeModeState(full))).toEqual({ ok: true, value: full });
    expect(writeModeState({ mode: 'test', prune: false })).toEqual({ PW_PERF_MODE: 'test' });
  });

  test('MODE_ENV_NAMES lists every variable of the contract', () => {
    expect([...MODE_ENV_NAMES]).toEqual([
      'PW_PERF_MODE',
      'PW_PERF_REPEAT',
      'PW_PERF_ENV',
      'PW_PERF_RUN_ID',
      'PW_PERF_OUTCOME_FILE',
      'PW_PERF_PRUNE',
      'PW_PERF_MAX_TESTS',
    ]);
  });
});

describe('isCiEnv', () => {
  test('a non-empty CI variable means CI, like the default reporter of Playwright', () => {
    expect(isCiEnv({ CI: 'true' })).toBe(true);
    expect(isCiEnv({ CI: '1' })).toBe(true);
    expect(isCiEnv({ CI: '' })).toBe(false);
    expect(isCiEnv({})).toBe(false);
  });
});
