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
  CustomSample,
  Entry,
  OutcomeFile,
  RequestSample,
} from './generated/formats.ts';

/** Names used by the spec for generated format types. */
export type Outcome = OutcomeFile;
export type RunReportAggregate = Aggregate;
/** Aggregate as in the run report, without 'evaluation' (added by the evaluation, 09). */
export type AggregateStats = Omit<Aggregate, 'evaluation'>;
export type ThresholdsEntry = Entry;
export type RawRequestSample = RequestSample;
export type RawCustomSample = CustomSample;
export type Kind = 'api' | 'custom';
export {
  DIFF_CATEGORIES,
  LIMIT_NAMES,
  LISTED_CATEGORIES,
  diffChangeText,
  diffCountsText,
  diffMarker,
  diffValuesText,
  limitLabel,
  limitValueText,
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
  ThresholdsDiff,
} from './thresholds.ts';
export { CLI_COMMAND, CONTEXT_CLOSED_FAILURE_TEXT, PACKAGE_NAME } from './constants.ts';
