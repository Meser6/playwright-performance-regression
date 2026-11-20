// Test metadata and sample identities (08, chapter 4).
import type { RawCustomSample, RawRequestSample } from '../types/index.ts';

/** Test metadata the reporter adds to every sample (08-REQ-06 – 08-REQ-08). */
export interface TestMeta {
  /** project + NUL + file + NUL + title (08-REQ-06); see testIdentity(). */
  identity: string;
  /** Exact template of 08-REQ-08; see resultId(). */
  resultId: string;
  title: string;
  project: string;
  file: string;
  line: number;
  repeatEachIndex: number;
  /** TestResult.retry: tie-break of the waterfall (08-REQ-38). */
  retry: number;
  /** See isFailedTest() (08-REQ-07). */
  failed: boolean;
  /** TestResult.startTime.getTime(): start of the test run in epoch ms (08-REQ-36). */
  startTime: number;
}

export interface EnrichedRequestSample extends RawRequestSample {
  test: TestMeta;
  /** Position in the batch's requests array, from 0 (08-REQ-08). */
  ordinal: number;
}

export interface EnrichedCustomSample extends RawCustomSample {
  test: TestMeta;
  /** Position in the batch's custom array, from 0 (08-REQ-08). */
  ordinal: number;
}

export type SampleKind = 'request' | 'custom';

/** Identity of a test for testCount and topTests; repetitions count once (08-REQ-06). */
export function testIdentity(project: string, file: string, title: string): string {
  return `${project}\u0000${file}\u0000${title}`;
}

/** Identity of one test result: TestCase.id, repeatEachIndex, TestResult.retry (08-REQ-08). */
export function resultId(testId: string, repeatEachIndex: number, retry: number): string {
  return `${testId}\u0000${repeatEachIndex}\u0000${retry}`;
}

/** Identity of a sample, unique in the run (08-REQ-08, 08-D-13). */
export function sampleId(result: string, kind: SampleKind, ordinal: number): string {
  return `${result}\u0000${kind}\u0000${ordinal}`;
}

type TestStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';

/**
 * A test failed when its status differs from the expected one and is not skipped (08-REQ-07,
 * 08-D-09): a test marked with test.fail() that fails is not failed.
 */
export function isFailedTest(status: TestStatus, expectedStatus: TestStatus): boolean {
  return status !== expectedStatus && status !== 'skipped';
}
