import type { Issue } from '../types/index.ts';

/**
 * Collapses repeated issues with the same code and message into the first occurrence with a
 * summed `count` (02-REQ-20). Order of first occurrence is kept.
 */
export function collapseIssues(issues: readonly Issue[]): Issue[] {
  const result: Issue[] = [];
  const index = new Map<string, number>();
  for (const issue of issues) {
    const id = `${issue.code}\u0000${issue.message}`;
    const at = index.get(id);
    const first = at === undefined ? undefined : result[at];
    if (first === undefined) {
      index.set(id, result.length);
      result.push({ ...issue });
    } else {
      first.count = (first.count ?? 1) + (issue.count ?? 1);
    }
  }
  return result;
}
