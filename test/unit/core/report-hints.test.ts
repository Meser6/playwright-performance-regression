// Headroom (check.usage, 11-REQ-30) and hints (11-REQ-34) of buildRunReport. Golden cases:
// test/golden/report/hints/cases.json (key facts → expected hints, boundary values of each rule).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { checkUsage, keyHeadroom, keyHints, withUsage } from '../../../src/core/report/index.ts';
import type { HintFacts, HintOptions } from '../../../src/core/report/index.ts';
import { HINT_CODES } from '../../../src/core/schema/index.ts';
import type { EvaluatedCheck, Hint } from '../../../src/core/types/index.ts';
import { GOLDEN_DIR } from '../../contract/golden.ts';

interface HintCase {
  name: string;
  input: Omit<HintFacts, 'evaluation'> & {
    evaluation: Omit<HintFacts['evaluation'], 'checks'> & { checks: EvaluatedCheck[] };
    options?: Partial<HintOptions>;
  };
  expected: Hint[];
}

const CASES = JSON.parse(
  readFileSync(join(GOLDEN_DIR, 'report', 'hints', 'cases.json'), 'utf8'),
) as HintCase[];
const DEFAULT_OPTIONS: HintOptions = {
  errorStatuses: ['5xx', 'FAILED', 'PENDING'],
  hardLimitFactor: 2,
};

function hintsOf(c: HintCase): Hint[] {
  const { options, ...facts } = c.input;
  return keyHints(
    { ...facts, evaluation: { ...facts.evaluation, checks: withUsage(facts.evaluation.checks) } },
    { ...DEFAULT_OPTIONS, ...options },
  );
}

describe('check.usage (11-REQ-30)', () => {
  test('11-AC-18 usage is actual / limit, (1 − actual) / (1 − limit) for apdex, 4 decimal places', () => {
    expect(checkUsage({ rule: 'percentile', actual: 870, limit: 1000 })).toBe(0.87);
    expect(checkUsage({ rule: 'median', actual: 1350, limit: 1000 })).toBe(1.35);
    expect(checkUsage({ rule: 'apdex', actual: 0.9, limit: 0.85 })).toBe(0.6667);
    expect(checkUsage({ rule: 'errors', actual: 0, limit: 0 })).toBe(0);
    expect(checkUsage({ rule: 'errors', actual: 0.01, limit: 0 })).toBeNull();
    expect(checkUsage({ rule: 'apdex', actual: 1, limit: 1 })).toBe(0);
    expect(checkUsage({ rule: 'apdex', actual: 0.99, limit: 1 })).toBeNull();
    expect(checkUsage({ rule: 'wilson', actual: 0.0500005, limit: 0.05 })).toBe(1);
    expect(checkUsage({ rule: 'p99', actual: 1000.01, limit: 1000 })).toBe(1);
  });

  test('11-AC-18 the key headroom is the largest usage, null counting as infinity; none without checks', () => {
    expect(keyHeadroom([{ usage: 0.2 }, { usage: 0.87 }, { usage: 0.5 }])).toBe(0.87);
    expect(keyHeadroom([{ usage: 0.2 }, { usage: null }])).toBe(Infinity);
    expect(keyHeadroom([])).toBeNull();
  });

  test('a passed check has usage at most 1, a failed one above 1 or null, across the golden cases', () => {
    for (const c of CASES) {
      for (const check of withUsage(c.input.evaluation.checks)) {
        if (check.passed) expect(check.usage ?? 2, c.name).toBeLessThanOrEqual(1);
        else if (check.usage !== null) expect(check.usage, c.name).toBeGreaterThan(1);
      }
    }
  });
});

describe('hints (11-REQ-34)', () => {
  test.each(CASES.map((c) => [c.name, c] as const))('11-AC-22 %s', (_, c) => {
    expect(hintsOf(c)).toEqual(c.expected);
  });

  test('11-AC-22 every hint code has a golden case and at most 3 hints are given', () => {
    const codes = new Set(CASES.flatMap((c) => c.expected.map((h) => h.code)));
    expect([...codes].sort()).toEqual([...HINT_CODES].sort());
    for (const c of CASES) expect(c.expected.length, c.name).toBeLessThanOrEqual(3);
    const five = CASES.find((c) => c.name.startsWith('a key matching five rules'));
    expect(five?.expected.map((h) => h.code)).toEqual([
      'HINT_HARD_LIMIT',
      'HINT_SLOWDOWN',
      'HINT_ERRORS_DOMINANT',
    ]);
  });

  test('hard limits disabled (gate.hardLimitFactor null) give no HINT_HARD_LIMIT', () => {
    const c = CASES[0] as HintCase;
    const { options: _options, ...facts } = c.input;
    const hints = keyHints(
      { ...facts, evaluation: { ...facts.evaluation, checks: withUsage(facts.evaluation.checks) } },
      { ...DEFAULT_OPTIONS, hardLimitFactor: null },
    );
    expect(hints.map((h) => h.code)).toEqual(['HINT_SLOWDOWN']);
  });
});
