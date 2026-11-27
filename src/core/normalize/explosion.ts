// Key explosion detection after aggregation (07-REQ-22).
import { CARDINALITY_MIN_KEYS, MAX_KEYS_WARNING } from './constants.ts';
import type { NormalizeIssue } from './key-builder.ts';

const EXAMPLES = 3;

interface ParsedKey {
  /** "<METHOD> <label>" */
  head: string;
  segments: string[];
  /** "", "?…" or "#…" */
  query: string;
}

/** Splits a key of the 07-REQ-01 format; null for other keys (e.g. from keyBuilder). */
function parseKey(key: string): ParsedKey | null {
  const space = key.indexOf(' ');
  if (space <= 0) return null;
  const slash = key.indexOf('/', space + 1);
  if (slash < 0) return null;
  const head = key.slice(0, slash);
  if (head.slice(space + 1).includes('?')) return null;
  const rest = key.slice(slash + 1);
  // The operation part (#…, 18-REQ-06) groups like the query: '#' in a segment is escaped.
  const hash = rest.indexOf('#');
  const question = rest.indexOf('?');
  const mark = hash >= 0 && (question < 0 || hash < question) ? hash : question;
  const path = mark < 0 ? rest : rest.slice(0, mark);
  return {
    head,
    segments: path === '' ? [] : path.split('/'),
    query: mark < 0 ? '' : rest.slice(mark),
  };
}

/**
 * NORMALIZE_HIGH_CARDINALITY for every group of at least CARDINALITY_MIN_KEYS keys that differ
 * only in the path segment at one position, and NORMALIZE_TOO_MANY_KEYS for more than
 * MAX_KEYS_WARNING keys (07-REQ-22). Groups and example keys are sorted.
 */
export function detectKeyExplosion(endpointKeys: readonly string[]): NormalizeIssue[] {
  const unique = [...new Set(endpointKeys)].sort();
  const groups = new Map<string, string[]>();
  for (const key of unique) {
    const parsed = parseKey(key);
    if (parsed === null) continue;
    parsed.segments.forEach((_, i) => {
      const template = parsed.segments.map((s, j) => (j === i ? '*' : s)).join('/');
      const id = `${parsed.head}/${template}${parsed.query}`;
      const list = groups.get(id);
      if (list === undefined) groups.set(id, [key]);
      else list.push(key);
    });
  }

  const issues: NormalizeIssue[] = [];
  for (const template of [...groups.keys()].sort()) {
    const keys = groups.get(template) ?? [];
    if (keys.length < CARDINALITY_MIN_KEYS) continue;
    const examples = keys.slice(0, EXAMPLES).join(', ');
    issues.push({
      code: 'NORMALIZE_HIGH_CARDINALITY',
      message: `${keys.length} endpoint keys differ only in one path segment: ${template} (e.g. ${examples}).`,
      hint: 'If the segment is test data, replace it with keys.extraIdPatterns or a keys.keyBuilder function.',
    });
  }
  if (unique.length > MAX_KEYS_WARNING) {
    issues.push({
      code: 'NORMALIZE_TOO_MANY_KEYS',
      message: `The run has ${unique.length} endpoint keys, more than ${MAX_KEYS_WARNING}.`,
      hint: 'Check the keys for test data and normalize it with keys.extraIdPatterns, keys.dropQueryParams or keys.keyBuilder.',
    });
  }
  return issues;
}
