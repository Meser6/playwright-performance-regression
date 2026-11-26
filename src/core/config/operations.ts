// Matching a request path against keys.operations (18-REQ-01). Shared by the collector, which
// reads the operation names, and the normalization, which builds the key.
import type { ResolvedOperationEntry, ResolvedUrlPattern } from './types.ts';

export interface OperationMatch {
  entry: ResolvedOperationEntry;
  /** Index in the path just after the match (the end of the tRPC prefix, 18-REQ-05). */
  end: number;
}

function matchEnd(path: string, pattern: ResolvedUrlPattern): number {
  if (typeof pattern === 'string') {
    const index = path.indexOf(pattern);
    return index < 0 ? -1 : index + pattern.length;
  }
  const found = pattern.exec(path);
  return found === null ? -1 : found.index + found[0].length;
}

/** The first entry whose match finds the path (without query), or null (18-REQ-01). */
export function matchOperationEntry(
  entries: readonly ResolvedOperationEntry[],
  path: string,
): OperationMatch | null {
  for (const entry of entries) {
    const end = matchEnd(path, entry.match);
    if (end >= 0) return { entry, end };
  }
  return null;
}
