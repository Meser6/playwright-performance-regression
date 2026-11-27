// Diagnostics of one test: collector issues, collapsed by code and message (05-REQ-19).
import type { ResolvedUrlPattern } from '../core/config/index.ts';
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

/**
 * COLLECTOR_OPERATION_UNKNOWN (18-REQ-08): a request matched keys.operations, but no operation
 * name could be read; its sample keeps the key without an operation. The message names the method
 * and the entry's pattern, never the URL, so repeated cases collapse into one entry.
 */
export function operationUnknown(
  method: string,
  pattern: ResolvedUrlPattern | null,
  reason?: string,
): Issue {
  const entry =
    pattern === null ? 'keys.operations' : `the keys.operations entry ${patternText(pattern)}`;
  return {
    code: 'COLLECTOR_OPERATION_UNKNOWN',
    message: `collector: a ${method} request matching ${entry} has no readable operation name, so it keeps the key without an operation${reason === undefined ? '' : ` (${reason})`}`,
    hint: 'GraphQL clients send operationName or a named operation in a JSON body (read up to 64 KB) or in the query parameters; tRPC clients put procedure names in the path. If the endpoint is neither, narrow the match of the entry.',
  };
}

function patternText(pattern: ResolvedUrlPattern): string {
  return typeof pattern === 'string' ? JSON.stringify(pattern) : String(pattern);
}
