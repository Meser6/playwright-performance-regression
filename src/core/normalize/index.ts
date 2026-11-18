// Endpoint key normalization (07).
export {
  CARDINALITY_MIN_KEYS,
  MAX_KEY_LENGTH,
  MAX_KEYS_WARNING,
  NORMALIZE_RULES_VERSION,
} from './constants.ts';
export { canonicalOrigin, createKeyBuilder, truncateKey } from './key-builder.ts';
export type { KeyBuilderContext, KeyResult, KeySample, NormalizeIssue } from './key-builder.ts';
export { ID_PATTERNS } from './patterns.ts';
