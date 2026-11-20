import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../../../src/core/config/index.ts';
import { sanitizeStepTitle } from '../../../src/core/steps/index.ts';
import type { SanitizeOptions } from '../../../src/core/steps/index.ts';

interface GoldenCase {
  id: string;
  input: string;
  expected: string;
  redacted: string[];
  options?: Partial<Pick<SanitizeOptions, 'normalizeTitles' | 'redactQuotedValues'>>;
}

const golden = JSON.parse(
  readFileSync(new URL('../../golden/steps/titles.json', import.meta.url), 'utf8'),
) as { cases: GoldenCase[] };

function options(overrides: Partial<SanitizeOptions> = {}): SanitizeOptions {
  const result = resolveConfig({}, {});
  if (!result.ok) throw new Error('defaults');
  const { keys } = result.value.config;
  return {
    normalizeTitles: true,
    redactQuotedValues: false,
    idPatterns: keys.idPatterns,
    extraIdPatterns: keys.extraIdPatterns,
    ...overrides,
  };
}

const sanitize = (title: string, overrides: Partial<SanitizeOptions> = {}) =>
  sanitizeStepTitle(title, options(overrides));

describe('06-AC-14 sanitizeStepTitle golden cases T01–T42', () => {
  test('every mandatory case is present', () => {
    const ids = new Set(golden.cases.map((c) => c.id.replace(/-[a-z]$/u, '')));
    for (let n = 1; n <= 42; n++) expect(ids.has(`T${String(n).padStart(2, '0')}`)).toBe(true);
  });

  test.each(golden.cases)('$id', (c) => {
    const result = sanitize(c.input, c.options);
    expect(result.text).toBe(c.expected);
    expect(result.redacted).toEqual(c.redacted);
  });

  test('normalizeTitles: false keeps 4711 in T01', () => {
    expect(sanitize('Open order 4711', { normalizeTitles: false }).text).toBe('Open order 4711');
  });

  test('T05 and T38 are two keys by default and one with redactQuotedValues', () => {
    expect(sanitize('Click "Save"').text).not.toBe(sanitize('Click "Cancel"').text);
    const redact = { redactQuotedValues: true };
    expect(sanitize('Click "Save"', redact).text).toBe(sanitize('Click "Cancel"', redact).text);
  });

  test('keys.extraIdPatterns apply to word cores', () => {
    const extra = { extraIdPatterns: [/^ORD-[0-9]+$/u] };
    expect(sanitize('Open ORD-12', extra).text).toBe('Open :id');
  });
});

describe('06-AC-22 cleanup', () => {
  test('NFD and NFC give one key', () => {
    expect(sanitize('Zamów').text).toBe(sanitize('Zamów').text);
  });

  test('a zero-width space gives the same key as without it', () => {
    expect(sanitize('Sub​mit').text).toBe('Submit');
  });

  test('the key separators in a title become ">"', () => {
    expect(sanitize('a › b » c').text).toBe('a > b > c');
  });
});

describe('06 chapter 11 privacy cases', () => {
  /** The replaced part of each privacy case (06, chapter 11). */
  const replaced: Record<string, string> = {
    T03: 'jan.kowalski@example.com',
    T04: 'jan@example.com',
    T06: 'https://app.example/orders/42?token=abc',
    T09: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln',
    T10: 'abc.def-123',
    T11: 'Secr3t!',
    T12: '9f8e7d',
    T23: '+48 600 100 200',
    T24: '192.168.0.1',
    T25: '85010112345',
    T40: '+48 600 100 200',
    T41: 'https://app.example/a?token=x',
  };
  test.each(Object.entries(replaced))(
    '%s keeps no fragment of the replaced part longer than 3 characters',
    (id, secret) => {
      const c = golden.cases.find((x) => x.id === id);
      if (c === undefined) throw new Error(id);
      const output = sanitize(c.input, c.options).text;
      for (let i = 0; i + 4 <= secret.length; i++) {
        expect(output).not.toContain(secret.slice(i, i + 4));
      }
    },
  );
});
