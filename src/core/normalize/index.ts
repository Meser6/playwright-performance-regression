// Endpoint key normalization (07).
export {
  CARDINALITY_MIN_KEYS,
  MAX_KEY_LENGTH,
  MAX_KEYS_WARNING,
  NORMALIZE_RULES_VERSION,
} from './constants.ts';
export { detectKeyExplosion } from './explosion.ts';
export { measuredBaseOrigins, normalizationFingerprint } from './fingerprint.ts';
export type { ProjectBaseUrl } from './fingerprint.ts';
export { canonicalOrigin, createKeyBuilder, truncateKey } from './key-builder.ts';
export type { KeyBuilderContext, KeyResult, KeySample, NormalizeIssue } from './key-builder.ts';
export { ID_PATTERNS } from './patterns.ts';
