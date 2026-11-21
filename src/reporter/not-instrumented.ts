// TESTS_NOT_INSTRUMENTED (09-REQ-34): tests of measured projects whose results have no sample
// batch, counted per test (test.id), not per result, with up to three files. Pure.
import type { Issue } from '../core/types/index.ts';
import type { ResultLike } from './types.ts';

/** Files named in the message; the rest is "and N other files". */
const MAX_FILES = 3;

/** Playwright's error of a result whose worker process died (runner/dispatcher). */
const WORKER_EXIT = /worker process exited unexpectedly/iu;

/** Test ids → file (relative to the config dir) of the tests without a batch. */
export type TestFiles = Record<string, string>;

/** True when the worker of this result exited unexpectedly, so the batch was lost. */
export function workerCrashed(result: ResultLike): boolean {
  return (result.errors ?? []).some((e) => WORKER_EXIT.test(e.message ?? ''));
}

function fileList(files: TestFiles): string {
  const names = [...new Set(Object.values(files))].sort();
  const shown = names.slice(0, MAX_FILES);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} and ${rest} other ${rest === 1 ? 'file' : 'files'}`;
  if (shown.length === 1) return shown[0] as string;
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1] as string}`;
}

/**
 * One warning for the run, or null. A test with a result that is neither instrumented nor lost
 * to a crashed worker counts only as not wrapped.
 */
export function notInstrumentedWarning(unwrapped: TestFiles, crashed: TestFiles): Issue | null {
  const lost: TestFiles = {};
  for (const [id, file] of Object.entries(crashed)) if (!(id in unwrapped)) lost[id] = file;
  const nUnwrapped = Object.keys(unwrapped).length;
  const nLost = Object.keys(lost).length;
  if (nUnwrapped === 0 && nLost === 0) return null;
  const message: string[] = [];
  const hint: string[] = [];
  if (nUnwrapped > 0) {
    const one = nUnwrapped === 1;
    message.push(
      `${nUnwrapped} ${one ? 'test' : 'tests'} in ${fileList(unwrapped)} ${one ? 'imports' : 'import'} test without withPerfFixtures() (e.g. straight from @playwright/test), so ${one ? 'it was' : 'they were'} not measured.`,
    );
    hint.push(
      'Import test from a test object wrapped with withPerfFixtures() (or from "playwright-performance-regression/test").',
    );
  }
  if (nLost > 0) {
    const one = nLost === 1;
    message.push(
      `${nLost} ${one ? 'test' : 'tests'} in ${fileList(lost)} lost ${one ? 'its' : 'their'} measurement because the worker process exited unexpectedly.`,
    );
    hint.push('Check the worker crash in the Playwright output above.');
  }
  return { code: 'TESTS_NOT_INSTRUMENTED', message: message.join(' '), hint: hint.join(' ') };
}
