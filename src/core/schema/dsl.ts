// Small building blocks for the hand-written format validators (01-REQ-36, 02-D-07). Each
// validator mirrors one JSON Schema in schemas/; a contract test checks that both give the same
// verdict. Semantics follow JSON Schema draft 2020-12 as implemented by Ajv: string lengths count
// code points, patterns use the `u` flag, numbers must be finite.

export interface Problem {
  /** JSON Pointer to the offending value ("" is the document root). */
  pointer: string;
  message: string;
}

/** Collects problems; stops collecting after `limit` (validation can stop early). */
export class Sink {
  readonly problems: Problem[] = [];
  readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  get full(): boolean {
    return this.problems.length >= this.limit;
  }

  add(pointer: string, message: string): void {
    if (!this.full) this.problems.push({ pointer, message });
  }
}

export interface Schema {
  /** Adds a problem to `sink` for every rule `value` breaks. */
  check(value: unknown, pointer: string, sink: Sink): void;
  /** True when `value` has the JSON type this schema expects (used to explain oneOf failures). */
  accepts(value: unknown): boolean;
  /** Short description of the expected value, e.g. "integer" or "null". */
  readonly expected: string;
}

export function child(pointer: string, key: string | number): string {
  return `${pointer}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function matches(schema: Schema, value: unknown, pointer = ''): boolean {
  const sink = new Sink(1);
  schema.check(value, pointer, sink);
  return sink.problems.length === 0;
}

function codePoints(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]))
    );
  }
  return false;
}

function quote(value: unknown): string {
  return JSON.stringify(value);
}

export interface StringOptions {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
}

export function str(options: StringOptions = {}): Schema {
  const { minLength, maxLength, pattern } = options;
  return {
    expected: 'string',
    accepts: (value) => typeof value === 'string',
    check(value, pointer, sink) {
      if (typeof value !== 'string') return sink.add(pointer, 'must be string');
      if (minLength !== undefined || maxLength !== undefined) {
        const length = codePoints(value);
        if (minLength !== undefined && length < minLength) {
          sink.add(pointer, `must NOT have fewer than ${minLength} characters`);
        }
        if (maxLength !== undefined && length > maxLength) {
          sink.add(pointer, `must NOT have more than ${maxLength} characters`);
        }
      }
      if (pattern !== undefined && !pattern.test(value)) {
        sink.add(pointer, `must match pattern "${pattern.source}"`);
      }
    },
  };
}

export interface NumberOptions {
  minimum?: number;
  maximum?: number;
}

function numeric(integer: boolean, options: NumberOptions): Schema {
  const { minimum, maximum } = options;
  const type = integer ? 'integer' : 'number';
  return {
    expected: type,
    accepts: (value) => typeof value === 'number',
    check(value, pointer, sink) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return sink.add(pointer, `must be ${type}`);
      }
      if (integer && !Number.isInteger(value)) return sink.add(pointer, 'must be integer');
      if (minimum !== undefined && value < minimum) sink.add(pointer, `must be >= ${minimum}`);
      if (maximum !== undefined && value > maximum) sink.add(pointer, `must be <= ${maximum}`);
    },
  };
}

export const int = (options: NumberOptions = {}): Schema => numeric(true, options);
export const num = (options: NumberOptions = {}): Schema => numeric(false, options);

export const bool: Schema = {
  expected: 'boolean',
  accepts: (value) => typeof value === 'boolean',
  check(value, pointer, sink) {
    if (typeof value !== 'boolean') sink.add(pointer, 'must be boolean');
  },
};

export const nul: Schema = {
  expected: 'null',
  accepts: (value) => value === null,
  check(value, pointer, sink) {
    if (value !== null) sink.add(pointer, 'must be null');
  },
};

/** JSON value of any type (schema `{}`), or of type object (`{ "type": "object" }`). */
export const anyObject: Schema = {
  expected: 'object',
  accepts: isRecord,
  check(value, pointer, sink) {
    if (!isRecord(value)) sink.add(pointer, 'must be object');
  },
};

export function constant(expected: string | number | boolean | null): Schema {
  return {
    expected: quote(expected),
    accepts: (value) => value === expected,
    check(value, pointer, sink) {
      if (value !== expected) sink.add(pointer, `must be equal to ${quote(expected)}`);
    },
  };
}

export function enumOf(values: readonly (string | number)[]): Schema {
  return {
    expected: values.map(quote).join(' | '),
    accepts: (value) => typeof value === 'string' || typeof value === 'number',
    check(value, pointer, sink) {
      if (!values.includes(value as string | number)) {
        sink.add(pointer, `must be one of ${values.map(quote).join(', ')}`);
      }
    },
  };
}

/** Exactly one alternative must match (JSON Schema oneOf). */
export function oneOf(...alternatives: Schema[]): Schema {
  const expected = alternatives.map((a) => a.expected).join(' or ');
  return {
    expected,
    accepts: (value) => alternatives.some((a) => a.accepts(value)),
    check(value, pointer, sink) {
      const matching = alternatives.filter((a) => matches(a, value, pointer)).length;
      if (matching === 1) return;
      if (matching > 1) return sink.add(pointer, 'must match exactly one allowed form');
      // Explain with the problems of the only alternative of the right type, if there is one.
      const candidates = alternatives.filter((a) => a.accepts(value));
      if (candidates.length === 1 && candidates[0] !== undefined) {
        return candidates[0].check(value, pointer, sink);
      }
      sink.add(pointer, `must be ${expected}`);
    },
  };
}

export const nullable = (schema: Schema): Schema => oneOf(schema, nul);

export interface ArrayOptions {
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
}

export function arr(items: Schema, options: ArrayOptions = {}): Schema {
  const { minItems, maxItems, uniqueItems } = options;
  return {
    expected: 'array',
    accepts: Array.isArray,
    check(value, pointer, sink) {
      if (!Array.isArray(value)) return sink.add(pointer, 'must be array');
      if (minItems !== undefined && value.length < minItems) {
        sink.add(pointer, `must NOT have fewer than ${minItems} items`);
      }
      if (maxItems !== undefined && value.length > maxItems) {
        sink.add(pointer, `must NOT have more than ${maxItems} items`);
      }
      if (uniqueItems === true) {
        const duplicate = value.findIndex((x, i) => value.slice(0, i).some((y) => deepEqual(x, y)));
        if (duplicate !== -1)
          sink.add(pointer, `must NOT have duplicate items (item ${duplicate})`);
      }
      for (let i = 0; i < value.length && !sink.full; i++) {
        items.check(value[i], child(pointer, i), sink);
      }
    },
  };
}

export interface ObjectOptions {
  /** Property names that must be present. Default: none. */
  required?: readonly string[];
  /** Extra checks on the whole object, run when it has the right type (if/then, anyOf, …). */
  refine?: (value: Record<string, unknown>, pointer: string, sink: Sink) => void;
}

/** Object with known properties and `additionalProperties: false`. */
export function obj(properties: Record<string, Schema>, options: ObjectOptions = {}): Schema {
  const { required = [], refine } = options;
  return {
    expected: 'object',
    accepts: isRecord,
    check(value, pointer, sink) {
      if (!isRecord(value)) return sink.add(pointer, 'must be object');
      for (const name of required) {
        if (!Object.hasOwn(value, name)) sink.add(pointer, `must have required property '${name}'`);
      }
      for (const [name, item] of Object.entries(value)) {
        if (sink.full) return;
        const schema = Object.hasOwn(properties, name) ? properties[name] : undefined;
        if (schema === undefined) {
          sink.add(pointer, `must NOT have additional property '${name}'`);
        } else {
          schema.check(item, child(pointer, name), sink);
        }
      }
      refine?.(value, pointer, sink);
    },
  };
}

export interface RecordOptions {
  /** Properties that must be present, checked with `values` like the rest. */
  required?: readonly string[];
}

/** Object used as a map: `propertyNames` and `additionalProperties` schemas. */
export function record(names: Schema, values: Schema, options: RecordOptions = {}): Schema {
  const { required = [] } = options;
  return {
    expected: 'object',
    accepts: isRecord,
    check(value, pointer, sink) {
      if (!isRecord(value)) return sink.add(pointer, 'must be object');
      for (const name of required) {
        if (!Object.hasOwn(value, name)) sink.add(pointer, `must have required property '${name}'`);
      }
      for (const [name, item] of Object.entries(value)) {
        if (sink.full) return;
        if (!matches(names, name)) sink.add(child(pointer, name), 'property name is invalid');
        values.check(item, child(pointer, name), sink);
      }
    },
  };
}

/** Lazily resolved schema, for definitions used before they are declared. */
export function ref(resolve: () => Schema): Schema {
  return {
    get expected() {
      return resolve().expected;
    },
    accepts: (value) => resolve().accepts(value),
    check: (value, pointer, sink) => resolve().check(value, pointer, sink),
  };
}
