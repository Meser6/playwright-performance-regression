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
export type ThresholdsEntry = Entry;
export type RawRequestSample = RequestSample;
export type RawCustomSample = CustomSample;
export type Kind = 'api' | 'custom';
