// Deterministic delay noise for the demo server (12-REQ-09): log-normal around the configured
// delay, from a seeded generator. No dependencies.

/** mulberry32: a small seeded 32-bit generator; values in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface NoiseOptions {
  seed: number;
  /** Spread: standard deviation of ln(delay); 0 gives constant delays. */
  sigma: number;
}

/**
 * Delays with median `medianMs` and log-normal spread: medianMs · exp(sigma · z), z standard
 * normal (Box-Muller). The same seed gives the same sequence.
 */
export function createNoise(options: NoiseOptions): (medianMs: number) => number {
  const random = seededRandom(options.seed);
  return (medianMs) => {
    if (options.sigma === 0 || medianMs === 0) return medianMs;
    const u1 = 1 - random();
    const u2 = random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.round(medianMs * Math.exp(options.sigma * z) * 10) / 10;
  };
}
