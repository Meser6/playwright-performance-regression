// Diagnostics of one test: collector issues, collapsed by code and message (05-REQ-19).
import type { Diagnostics, Issue } from '../core/types/index.ts';

/**
 * A Diagnostics sink that collapses repeated issues (same code and message) into one entry
 * whose `count` is the number of occurrences; an issue that carries its own `count` adds that
 * many. A single occurrence has no `count`.
 */
export function createDiagnostics(): Diagnostics {
  const entries = new Map<string, Issue>();
  return {
    add(issue: Issue): void {
      const id = `${issue.code}\u0000${issue.message}`;
      const existing = entries.get(id);
      if (existing === undefined) {
        entries.set(id, { ...issue });
        return;
      }
      existing.count = (existing.count ?? 1) + (issue.count ?? 1);
    },
    list(): Issue[] {
      return [...entries.values()].map((issue) => ({ ...issue }));
    },
  };
}

/** Message text of an unknown thrown value. */
export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
