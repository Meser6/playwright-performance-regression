import { describe, expect, test } from 'vitest';
import { ceilTo, floorTo, roundMs, stringifyStable } from '../../../src/core/format/index.ts';

describe('rounding (02-REQ-07, 02-REQ-08)', () => {
  test('roundMs rounds durations to 0.1 ms', () => {
    expect(roundMs(123.44)).toBe(123.4);
    expect(roundMs(123.45)).toBe(123.5);
    expect(roundMs(0.04)).toBe(0);
    expect(roundMs(812)).toBe(812);
  });

  test('02-AC-09 ceilTo and floorTo remove float representation errors first', () => {
    expect(100 * 1.1).toBe(110.00000000000001);
    expect(ceilTo(100 * 1.1, 0)).toBe(110);
    expect(ceilTo(0.0275, 3)).toBe(0.028);
    expect(floorTo(0.9475, 3)).toBe(0.947);
  });

  test('ceilTo and floorTo round in the stated direction', () => {
    expect(ceilTo(110.2, 0)).toBe(111);
    expect(ceilTo(110, 0)).toBe(110);
    expect(ceilTo(0.0271, 3)).toBe(0.028);
    expect(floorTo(0.9479, 3)).toBe(0.947);
    expect(floorTo(0.947, 3)).toBe(0.947);
    expect(floorTo(0.1 + 0.2, 1)).toBe(0.3);
  });
});

describe('stringifyStable (01-REQ-20, 02-REQ-04)', () => {
  test('02-AC-07 sorts keys at every level, indents with 2 spaces and ends with a newline', () => {
    const text = stringifyStable({ b: 1, a: { d: [3, { z: true, y: null }], c: 'x' } });
    expect(text).toBe(
      [
        '{',
        '  "a": {',
        '    "c": "x",',
        '    "d": [',
        '      3,',
        '      {',
        '        "y": null,',
        '        "z": true',
        '      }',
        '    ]',
        '  },',
        '  "b": 1',
        '}',
        '',
      ].join('\n'),
    );
  });

  test('02-AC-07 serialising parsed output again gives the same text', () => {
    const value = { z: [1, 2.5, 'ż'], '10': 1, '9': 2, a: {}, b: [], c: { e: '"\n' } };
    const text = stringifyStable(value);
    expect(stringifyStable(JSON.parse(text))).toBe(text);
  });

  test('02-AC-07 integer-like keys are sorted as text, not numerically', () => {
    expect(stringifyStable({ '9': 0, '10': 0 })).toBe('{\n  "10": 0,\n  "9": 0\n}\n');
  });

  test('02-AC-11 non-ASCII keys are ordered by UTF-16 code units', () => {
    const text = stringifyStable({ ż: 1, a: 2, Ä: 3, Z: 4 });
    expect(text).toBe('{\n  "Z": 4,\n  "a": 2,\n  "Ä": 3,\n  "ż": 1\n}\n');
    // Astral characters sort by their surrogates (code units), not by code point.
    expect(stringifyStable({ '\u{1F600}': 1, '～': 2 })).toBe(
      '{\n  "\u{1F600}": 1,\n  "～": 2\n}\n',
    );
  });

  test('empty containers and scalars', () => {
    expect(stringifyStable({ a: {}, b: [] })).toBe('{\n  "a": {},\n  "b": []\n}\n');
    expect(stringifyStable([])).toBe('[]\n');
    expect(stringifyStable('x')).toBe('"x"\n');
    expect(stringifyStable(-0)).toBe('0\n');
  });

  test('omits object properties that are undefined', () => {
    expect(stringifyStable({ a: 1, hint: undefined })).toBe('{\n  "a": 1\n}\n');
  });

  test('02-REQ-09 NaN, Infinity, undefined array items and non-JSON values throw', () => {
    expect(() => stringifyStable({ a: Number.NaN })).toThrow(/\/a.*NaN/);
    expect(() => stringifyStable({ a: [1, Infinity] })).toThrow(/\/a\/1/);
    expect(() => stringifyStable([undefined])).toThrow(/undefined/);
    expect(() => stringifyStable(undefined)).toThrow(/undefined/);
    expect(() => stringifyStable({ f: () => 1 })).toThrow(/function/);
    expect(() => stringifyStable({ d: new Date(0) })).toThrow(/plain object/);
    expect(() => stringifyStable({ m: new Map() })).toThrow(/plain object/);
    expect(() => stringifyStable({ n: 1n })).toThrow(/bigint/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => stringifyStable(cyclic)).toThrow(/circular/);
  });

  test('a shared (non-circular) reference is serialised twice', () => {
    const shared = { x: 1 };
    expect(stringifyStable({ a: shared, b: shared })).toBe(
      '{\n  "a": {\n    "x": 1\n  },\n  "b": {\n    "x": 1\n  }\n}\n',
    );
  });

  test('objects with a null prototype are plain objects', () => {
    const value = Object.assign(Object.create(null) as object, { b: 1, a: 2 });
    expect(stringifyStable(value)).toBe('{\n  "a": 2,\n  "b": 1\n}\n');
  });
});
