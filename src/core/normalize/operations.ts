// The operation part of an endpoint key (18-REQ-06); the names come from the sample batch.

/** Names of a batch shown in a key; the rest is counted (18-REQ-06, P-13). */
export const MAX_OPERATIONS_IN_KEY = 10;

/** The operation part of a key: sorted unique names joined with +, at most 10 (18-REQ-06). */
export function operationKeyPart(names: readonly string[]): string {
  // Default sort compares UTF-16 code units.
  const unique = [...new Set(names)].sort();
  if (unique.length <= MAX_OPERATIONS_IN_KEY) return unique.join('+');
  return `${unique.slice(0, MAX_OPERATIONS_IN_KEY).join('+')}+…(${String(unique.length)})`;
}
