// Evaluation of keys, gate policy and exit outcome (09).
export { allowedViolations, evaluate } from './evaluate.ts';
export { defaultLimits, entryLimits } from './limits.ts';
export type { Limits } from './limits.ts';
export { MUTE_EXPIRY_WARN_DAYS } from './muting.ts';
export { assessRun, buildOutcome } from './outcome.ts';
export type { RunAssessment, RunAssessmentInput } from './outcome.ts';
export { RULES } from './rules.ts';
export { sourceForKind } from './types.ts';
export type { Rule } from './rules.ts';
export type {
  EvaluateOptions,
  Evaluation,
  EvaluationStatus,
  LoadedThresholds,
  LoadedThresholdsFile,
  RunSource,
} from './types.ts';
