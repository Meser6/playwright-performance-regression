// Thresholds derivation and diff report (10).
export { entrySelfConsistent } from './consistency.ts';
export { ERR_SELF_GAP, WILSON_SELF_GAP } from './constants.ts';
export { deriveThresholds } from './derive.ts';
export { deriveEntry, derivationSettings } from './formulas.ts';
export { DIFF_CATEGORIES, LIMIT_NAMES } from './types.ts';
export type {
  CompleteEntry,
  DeriveOptions,
  DerivedFile,
  DerivedThresholds,
  DiffCategory,
  EntryLimits,
  KeyDiff,
  LimitChange,
  LimitName,
  ThresholdsDiff,
} from './types.ts';
export { diffThresholds } from './diff.ts';
export { formatThresholdsDiffMarkdown } from './markdown.ts';
