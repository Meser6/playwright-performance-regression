import { describe, expect, test } from 'vitest';
import { notInstrumentedWarning, workerCrashed } from '../../../src/reporter/not-instrumented.ts';
import { result } from './harness.ts';

describe('TESTS_NOT_INSTRUMENTED (09-REQ-34)', () => {
  test('no tests without a batch: no warning', () => {
    expect(notInstrumentedWarning({}, {})).toBeNull();
  });

  test('09-AC-31 names up to three files, then the number of other files', () => {
    const files = ['e.spec.ts', 'a.spec.ts', 'd.spec.ts', 'b.spec.ts', 'c.spec.ts'];
    const tests = Object.fromEntries(files.map((f, i) => [`t${i}`, f]));
    expect(notInstrumentedWarning(tests, {})?.message).toBe(
      '5 tests in a.spec.ts, b.spec.ts, c.spec.ts and 2 other files import test without withPerfFixtures() (e.g. straight from @playwright/test), so they were not measured.',
    );
    expect(
      notInstrumentedWarning({ t1: 'a.spec.ts', t2: 'b.spec.ts', t3: 'a.spec.ts' }, {})?.message,
    ).toMatch(/^3 tests in a\.spec\.ts and b\.spec\.ts import/u);
    const four = { t1: 'a', t2: 'b', t3: 'c', t4: 'd' };
    expect(notInstrumentedWarning(four, {})?.message).toMatch(
      /^4 tests in a, b, c and 1 other file import/u,
    );
  });

  test('09-AC-31 one test: singular text; both groups: both sentences and hints', () => {
    const warning = notInstrumentedWarning(
      { t1: 'tests/api.spec.ts' },
      { t2: 'tests/cart.spec.ts' },
    );
    expect(warning).toEqual({
      code: 'TESTS_NOT_INSTRUMENTED',
      message:
        '1 test in tests/api.spec.ts imports test without withPerfFixtures() (e.g. straight from @playwright/test), so it was not measured. 1 test in tests/cart.spec.ts lost its measurement because the worker process exited unexpectedly.',
      hint: 'Import test from a test object wrapped with withPerfFixtures() (or from "playwright-performance-regression/test"), also in API tests that use the request fixture. Check the worker crash in the Playwright output above.',
    });
  });

  test('a test that is also unwrapped in other results counts only as unwrapped', () => {
    const warning = notInstrumentedWarning({ t1: 'a.spec.ts' }, { t1: 'a.spec.ts' });
    expect(warning?.message).not.toMatch(/worker/u);
  });

  test('workerCrashed reads the errors of the result', () => {
    expect(workerCrashed(result([]))).toBe(false);
    expect(
      workerCrashed(result([], { errors: [{ message: 'Timeout of 30000ms exceeded.' }] })),
    ).toBe(false);
    expect(
      workerCrashed(
        result([], {
          errors: [
            {},
            { message: 'Error: worker process exited unexpectedly (code=null, signal=SIGKILL)' },
          ],
        }),
      ),
    ).toBe(true);
  });
});
