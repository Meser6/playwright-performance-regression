// Domain types of the file formats, generated from schemas/ (02-REQ-02), and the shared core
// types (01, chapter 4.1).
export type * from './generated/formats.ts';
export type {
  CliIssue,
  ConfigIssue,
  DeepPartial,
  Diagnostics,
  IoIssue,
  ModeIssue,
  Override,
  Result,
} from './common.ts';
export { ConfigError } from './common.ts';

import type {
  Aggregate,
  StepAggregate,
  Check,
  Entry,
  KeyEvaluation,
  OutcomeFile,
  ApiRequestSample,
  RequestSample,
} from './generated/formats.ts';

/** Names used by the spec for generated format types. */
export type Outcome = OutcomeFile;
export type RunReportAggregate = Aggregate;
/**
 * Aggregate as in the run report, without 'evaluation' (added by the evaluation, 09) and
 * 'hints' (added by buildRunReport, 11-REQ-34).
 */
export type AggregateStats = Omit<Aggregate, 'evaluation' | 'hints'>;
/** Step aggregate without 'evaluation' and 'hints', like AggregateStats (06-REQ-28). */
export type StepAggregateStats = Omit<StepAggregate, 'evaluation' | 'hints'>;
export type RunReportStepAggregate = StepAggregate;
/** A check as the evaluation produces it; buildRunReport adds `usage` (11-REQ-30). */
export type EvaluatedCheck = Omit<Check, 'usage'>;
/** Evaluation of one key as the evaluation produces it (09), checks without `usage`. */
export type EvaluatedKey = Omit<KeyEvaluation, 'checks'> & { checks: EvaluatedCheck[] };
export type ThresholdsEntry = Entry;
export type RawRequestSample = RequestSample;
export type RawApiRequestSample = ApiRequestSample;
/** Kinds of keys, in the order of every list and file (06-REQ-15). */
export type Kind = 'api' | 'step';
export const KINDS: readonly Kind[] = ['api', 'step'];
export {
  DIFF_CATEGORIES,
  LIMIT_NAMES,
  DIFF_LIMIT_NAMES,
  LISTED_CATEGORIES,
  diffChangeText,
  diffCountsText,
  diffMarker,
  diffValuesText,
  limitLabel,
  limitValueText,
  skippedReasonText,
} from './thresholds.ts';
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
  SkippedSamples,
  ThresholdsDiff,
} from './thresholds.ts';
export {
  ABORT_FAILURE_TEXTS,
  CONFIG_FILE_BASENAME,
  CONFIG_FILE_EXTENSIONS,
  CONTEXT_CLOSED_FAILURE_TEXT,
  DOCS_CONFIG_URL,
  INIT_COMMAND,
  PACKAGE_NAME,
  PRUNE_COMMAND,
  REPOSITORY_URL,
  REQUEST_KEY_PREFIX,
  SAMPLES_ATTACHMENT_NAME,
  THRESHOLDS_COMMAND,
  isRequestKey,
  COLD_WARN_RATIO,
} from './constants.ts';
