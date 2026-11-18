// Deterministic JSON text for every file the package writes (01-REQ-20, 02-REQ-04, 02-REQ-09).

const INDENT = '  ';

function fail(pointer: string, what: string): never {
  throw new TypeError(
    `stringifyStable: value at "${pointer}" is ${what}, which cannot be written to JSON`,
  );
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function escapePointer(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}

function write(value: unknown, pointer: string, indent: string, ancestors: Set<object>): string {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) fail(pointer, String(value));
      return JSON.stringify(value);
    case 'undefined':
      return fail(pointer, 'undefined');
    case 'object':
      break;
    default:
      return fail(pointer, typeof value);
  }
  if (value === null) return 'null';
  if (ancestors.has(value)) fail(pointer, 'a circular reference');
  const inner = indent + INDENT;
  ancestors.add(value);
  let text: string;
  if (Array.isArray(value)) {
    const items = value.map((item, i) => inner + write(item, `${pointer}/${i}`, inner, ancestors));
    text = items.length === 0 ? '[]' : `[\n${items.join(',\n')}\n${indent}]`;
  } else {
    if (!isPlainObject(value)) fail(pointer, 'not a plain object');
    const record = value as Record<string, unknown>;
    // Default sort compares UTF-16 code units; never localeCompare (02-REQ-04).
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    const entries = keys.map(
      (key) =>
        `${inner}${JSON.stringify(key)}: ${write(record[key], `${pointer}/${escapePointer(key)}`, inner, ancestors)}`,
    );
    text = entries.length === 0 ? '{}' : `{\n${entries.join(',\n')}\n${indent}}`;
  }
  ancestors.delete(value);
  return text;
}

/**
 * JSON text with object keys sorted by UTF-16 code units at every level, 2-space indent and a
 * final newline (02-REQ-04). Object properties that are undefined are omitted. NaN, Infinity,
 * undefined array items and values that are not JSON (functions, bigint, class instances,
 * circular references) are programming errors and throw (02-REQ-09).
 */
export function stringifyStable(value: unknown): string {
  return `${write(value, '', '', new Set())}\n`;
}
