// Deterministic hashing used instead of a random number generator (08-REQ-15, 01 chapter 5).

/** Seed of the hashes in truncated keys and the normalization fingerprint (07-REQ-18, 07-REQ-21). */
export const FIXED_HASH_SEED = 0;

/**
 * cyrb53: a 53-bit hash of the UTF-16 code units of `input` with a 32-bit `seed`. The result is
 * a safe integer in [0, 2^53). A documented algorithm constant: changing it changes sampling,
 * truncated keys and fingerprints (08-REQ-15).
 */
export function hash53(input: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Text form of hash53 with FIXED_HASH_SEED: 14 lowercase hex digits, zero-padded (08-REQ-15). */
export function hashHex(input: string): string {
  return hash53(input, FIXED_HASH_SEED).toString(16).padStart(14, '0');
}
