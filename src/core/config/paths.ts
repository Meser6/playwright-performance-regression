// Option paths and values in config messages (03-REQ-12).
import { isRecord } from '../schema/dsl.ts';

/** Path of an option or value: property names and array indexes. */
export type Segment = string | number;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

/** Option path as users write it: `measure.exclude[1].regex`, `keys.origins["https://a.b"]`. */
export function formatPath(segments: readonly Segment[]): string {
  let path = '';
  for (const segment of segments) {
    if (typeof segment === 'number') path += `[${segment}]`;
    else if (IDENTIFIER.test(segment)) path += path === '' ? segment : `.${segment}`;
    else path += `[${JSON.stringify(segment)}]`;
  }
  return path;
}

/** Segments of a JSON Pointer into `document`; indexes into arrays become numbers. */
export function pointerSegments(pointer: string, document: unknown): Segment[] {
  if (pointer === '') return [];
  const segments: Segment[] = [];
  let node = document;
  for (const raw of pointer.slice(1).split('/')) {
    const name = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(node)) {
      const index = Number(name);
      segments.push(index);
      node = node[index] as unknown;
    } else {
      segments.push(name);
      node = isRecord(node) && Object.hasOwn(node, name) ? node[name] : undefined;
    }
  }
  return segments;
}

/** Value at `segments`, or undefined when the path does not exist. */
export function valueAt(document: unknown, segments: readonly Segment[]): unknown {
  let node = document;
  for (const segment of segments) {
    if (Array.isArray(node) && typeof segment === 'number') node = node[segment] as unknown;
    else if (isRecord(node) && typeof segment === 'string' && Object.hasOwn(node, segment)) {
      node = node[segment];
    } else return undefined;
  }
  return node;
}

/** Defines an own property; safe for names such as "__proto__". */
export function define(target: Record<string, unknown>, name: string, value: unknown): void {
  Object.defineProperty(target, name, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

const MAX_SHOWN = 60;

/** Short description of a received value for messages, e.g. `"5"`, `12`, `a function`. */
export function describeValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'function') return 'a function';
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'number') return String(value);
  if (value instanceof RegExp) return String(value);
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    text = undefined;
  }
  if (text === undefined) return Array.isArray(value) ? 'an array' : 'an object';
  return text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN - 1)}…` : text;
}

/** Levenshtein distance between two option names. */
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}
