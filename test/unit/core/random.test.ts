import { describe, expect, test } from 'vitest';
import { FIXED_HASH_SEED, hash53, hashHex } from '../../../src/core/random/index.ts';

describe('hash53 (08-REQ-15)', () => {
  // Control values of the reference cyrb53 implementation (seed 0).
  test.each([
    ['a', 7929297801672961],
    ['b', 8684336938537663],
    ['revenge', 4051478007546757],
    ['revenue', 8309097637345594],
    ['', 3338908027751811],
  ])('cyrb53 control value for %j', (input, expected) => {
    expect(hash53(input, 0)).toBe(expected);
  });

  test('the seed changes the hash', () => {
    expect(hash53('a', 1)).toBe(5368154436228575);
    expect(hash53('a', 1)).not.toBe(hash53('a', 0));
  });

  test('results are safe integers below 2^53', () => {
    for (let i = 0; i < 1000; i++) {
      const h = hash53(`key-${i}`, i);
      expect(Number.isSafeInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 53);
    }
  });

  test('hashes UTF-16 code units, including lone surrogates', () => {
    expect(hash53('\ud83d', 0)).not.toBe(hash53('\ude00', 0));
    expect(hash53('😀', 0)).toBe(hash53('😀', 0));
  });

  test('FIXED_HASH_SEED is 0', () => {
    expect(FIXED_HASH_SEED).toBe(0);
  });

  test('hashHex gives 14 lowercase hex digits, zero-padded', () => {
    expect(hashHex('a')).toBe((7929297801672961).toString(16).padStart(14, '0'));
    for (let i = 0; i < 2000; i++) expect(hashHex(`k${i}`)).toMatch(/^[0-9a-f]{14}$/);
    // A small hash value is padded with zeros.
    let padded: string | undefined;
    for (let i = 0; padded === undefined && i < 100_000; i++) {
      if (hash53(`p${i}`, FIXED_HASH_SEED) < 16 ** 13) padded = hashHex(`p${i}`);
    }
    expect(padded).toMatch(/^0[0-9a-f]{13}$/);
  });
});
