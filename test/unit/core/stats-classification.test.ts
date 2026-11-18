// Sample classification and identities (08, chapters 3 and 4).
import { describe, expect, test } from 'vitest';
import {
  ABORT_FAILURE_TEXTS,
  compileStatusMatcher,
  isFailedTest,
  requestStatusLabel,
  resultId,
  sampleId,
  testIdentity,
} from '../../../src/core/stats/index.ts';
import { CONTEXT_CLOSED_FAILURE_TEXT } from '../../../src/core/types/index.ts';

describe('status labels (08-REQ-05)', () => {
  test('HTTP codes become their text, PENDING stays PENDING', () => {
    expect(requestStatusLabel({ status: 200 })).toBe('200');
    expect(requestStatusLabel({ status: 503 })).toBe('503');
    expect(requestStatusLabel({ status: 'PENDING' })).toBe('PENDING');
  });

  test('ABORT_FAILURE_TEXTS has the texts measured per engine and the context-closed text', () => {
    expect([...ABORT_FAILURE_TEXTS].sort()).toEqual(
      [
        'net::ERR_ABORTED',
        'NS_BINDING_ABORTED',
        'NS_ERROR_ABORT',
        'cancelled',
        CONTEXT_CLOSED_FAILURE_TEXT,
      ].sort(),
    );
    expect(CONTEXT_CLOSED_FAILURE_TEXT).toBe('pw-perf: context closed');
  });

  describe('08-AC-17 abort texts are ABORTED, other failure texts stay FAILED', () => {
    test.each([...ABORT_FAILURE_TEXTS])(
      '08-AC-17 FAILED with failureText %j is ABORTED',
      (text) => {
        expect(requestStatusLabel({ status: 'FAILED', failureText: text })).toBe('ABORTED');
      },
    );

    test.each(['Blocked by Web Inspector', 'net::ERR_FAILED', 'NS_ERROR_FAILURE', 'unknown'])(
      '08-AC-17 FAILED with failureText %j stays FAILED',
      (text) => {
        expect(requestStatusLabel({ status: 'FAILED', failureText: text })).toBe('FAILED');
      },
    );
  });

  test('FAILED without failureText stays FAILED', () => {
    expect(requestStatusLabel({ status: 'FAILED' })).toBe('FAILED');
  });
});

describe('status patterns (08-REQ-01, 08-REQ-30)', () => {
  test('a class matches every HTTP code of that class, an exact code only itself', () => {
    const matches = compileStatusMatcher(['2xx', '304']);
    expect(['200', '204', '299', '304'].every(matches)).toBe(true);
    expect(['301', '404', '500', 'FAILED', 'ABORTED', 'PENDING'].some(matches)).toBe(false);
  });

  test('symbolic labels match only when listed', () => {
    const defaults = compileStatusMatcher(['5xx', 'FAILED', 'PENDING']);
    expect(defaults('500')).toBe(true);
    expect(defaults('FAILED')).toBe(true);
    expect(defaults('PENDING')).toBe(true);
    expect(defaults('ABORTED')).toBe(false);
    expect(defaults('404')).toBe(false);
    expect(compileStatusMatcher(['ABORTED'])('ABORTED')).toBe(true);
  });

  test('a class does not match symbolic labels or other lengths', () => {
    const matches = compileStatusMatcher(['5xx']);
    expect(matches('5000')).toBe(false);
    expect(matches('50')).toBe(false);
  });
});

describe('test and sample identity (08-REQ-06, 08-REQ-07, 08-REQ-08)', () => {
  test('08-AC-15 resultId and sampleId have the exact template with NUL separators', () => {
    const id = resultId('abc123-def', 2, 1);
    expect(id).toBe('abc123-def\u00002\u00001');
    expect(sampleId(id, 'request', 0)).toBe('abc123-def\u00002\u00001\u0000request\u00000');
    expect(sampleId(id, 'custom', 12)).toBe('abc123-def\u00002\u00001\u0000custom\u000012');
  });

  test('test identity is project, file and title without repeatEachIndex', () => {
    expect(testIdentity('chromium', 'tests/a.spec.ts', 'suite › test')).toBe(
      'chromium\u0000tests/a.spec.ts\u0000suite › test',
    );
  });

  test.each([
    ['passed', 'passed', false],
    ['failed', 'passed', true],
    ['timedOut', 'passed', true],
    ['interrupted', 'passed', true],
    ['skipped', 'passed', false],
    // test.fail(): a failing test is the expected outcome.
    ['failed', 'failed', false],
    ['passed', 'failed', true],
  ] as const)('08-AC-07 status %s with expected %s → failed: %s', (status, expected, failed) => {
    expect(isFailedTest(status, expected)).toBe(failed);
  });
});
