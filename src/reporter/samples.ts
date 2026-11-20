// onTestEnd: test metadata of the samples (08, chapter 4) and the sample batch attachments
// (02-REQ-14, 01-REQ-18).
import { isFailedTest, resultId, testIdentity } from '../core/stats/index.ts';
import type { TestMeta } from '../core/stats/index.ts';
import { SAMPLES_ATTACHMENT_NAME } from '../core/types/index.ts';
import type { ResultLike, SuiteLike, TestLike } from './types.ts';

/** Titles from the outermost describe to the test, joined with " › " (testRef.title). */
export function testTitle(test: TestLike): string {
  const titles = [test.title];
  for (
    let suite: SuiteLike | undefined = test.parent;
    suite?.type === 'describe';
    suite = suite.parent
  ) {
    titles.unshift(suite.title);
  }
  return titles.join(' › ');
}

export function projectName(test: TestLike): string {
  return test.parent.project()?.name ?? '';
}

/** Metadata added to every sample of one test result (08-REQ-06 – 08-REQ-08). */
export function testMeta(test: TestLike, result: ResultLike, file: string): TestMeta {
  const title = testTitle(test);
  const project = projectName(test);
  return {
    identity: testIdentity(project, file, title),
    resultId: resultId(test.id, test.repeatEachIndex, result.retry),
    title,
    project,
    file,
    line: test.location.line,
    repeatEachIndex: test.repeatEachIndex,
    retry: result.retry,
    failed: isFailedTest(result.status, test.expectedStatus),
    startTime: result.startTime.getTime(),
  };
}

/** Bodies of the sample batch attachments in order of occurrence (02-REQ-14). */
export function sampleAttachments(result: ResultLike): string[] {
  return result.attachments
    .filter((a) => a.name === SAMPLES_ATTACHMENT_NAME)
    .map((a) => (a.body === undefined ? '' : a.body.toString('utf8')));
}

/** Playwright's own trace and video attachments: set in a test file with test.use (04-REQ-19). */
export function hasTraceOrVideo(result: ResultLike): boolean {
  return result.attachments.some((a) => a.name === 'trace' || a.name === 'video');
}
