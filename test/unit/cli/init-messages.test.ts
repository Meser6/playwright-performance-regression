// Texts of the init wizard (04-REQ-43): one module, the same keys and placeholders in every
// language; names of files, options and code stay as they are in English.
import { describe, expect, test } from 'vitest';
import { LANGUAGES, MESSAGES, format, placeholders } from '../../../src/cli/init/messages.ts';

/** Option names, tags, calls, file names and codes: never translated. */
const LITERAL =
  /--[a-z][a-z-]*|@perf|@playwright\/test|\b[\w.]+\(\)|\b[\w.*<>-]+\.(?:json|ts|yml|md)\b|INIT_[A-Z_]+/gu;

describe('init wizard texts', () => {
  test('04-AC-23 the 7 languages, en first', () => {
    expect(LANGUAGES).toEqual(['en', 'es', 'fr', 'pl', 'it', 'uk', 'ru']);
  });

  test('04-AC-23 every language has every key with the same placeholders', () => {
    const keys = Object.keys(MESSAGES.en).sort();
    for (const lang of LANGUAGES) {
      const texts: Record<string, string> = MESSAGES[lang];
      expect(Object.keys(texts).sort(), lang).toEqual(keys);
      for (const key of keys) {
        const text = texts[key] as string;
        const en = MESSAGES.en[key as keyof typeof MESSAGES.en];
        expect(text.trim(), `${lang}.${key}`).not.toBe('');
        expect(placeholders(text), `${lang}.${key}`).toEqual(placeholders(en));
        for (const literal of new Set(en.match(LITERAL) ?? [])) {
          expect(text, `${lang}.${key} keeps ${literal}`).toContain(literal);
        }
      }
    }
  });

  test('04-AC-23 the red box title line fits 80 columns in every language', () => {
    // The title line is "✖ INIT_TEST_OBJECT_MANUAL · <title>" inside a box with 76 inner columns
    // and is cut, not wrapped, when it is longer.
    const prefix = '✖ INIT_TEST_OBJECT_MANUAL · '.length;
    for (const lang of LANGUAGES) {
      for (const key of ['boxTitle', 'boxTitleSteps'] as const) {
        expect(prefix + MESSAGES[lang][key].length, `${lang}.${key}`).toBeLessThanOrEqual(76);
      }
    }
  });

  test('04-AC-23 typography: no-break space before French : ; ? ! and typographic apostrophes', () => {
    for (const [key, text] of Object.entries(MESSAGES.fr)) {
      expect(text, `fr.${key}`).not.toMatch(/ [:;?!](?:\s|$)/u);
    }
    for (const lang of ['fr', 'it'] as const) {
      for (const [key, text] of Object.entries(MESSAGES[lang])) {
        expect(text, `${lang}.${key}`).not.toMatch(/\p{L}'\p{L}/u);
      }
    }
  });

  test('format fills the placeholders and keeps other braces', () => {
    expect(format('{a} and {b}, defineConfig({...})', { a: 'x', b: 2 })).toBe(
      'x and 2, defineConfig({...})',
    );
    expect(placeholders('{b} {a} {b} {...}')).toEqual(['a', 'b']);
  });
});
