// Types of the evaluation (09, chapter 10).
import type { SchemaIssue } from '../schema/index.ts';
import type {
  EvaluationCounts,
  HostFingerprint,
  Issue,
  EvaluatedKey,
  Kind,
  RunReport,
  ThresholdFileInfo,
  ThresholdsFile,
} from '../types/index.ts';

/**
 * A thresholds file as read by the reporter (09-REQ-01, 09-REQ-02). Reading is IO; the core
 * gets the result. `path` is relative to configDir, with forward slashes.
 */
export type LoadedThresholdsFile =
  | { status: 'loaded'; kind: Kind; path: string; file: ThresholdsFile; migratedFrom?: number }
  | {
      status: 'missing';
      kind: Kind;
      path: string;
      /** A file without the environment label exists next to it (09-REQ-03). */
      envlessFileExists: boolean;
    }
  | { status: 'invalid'; kind: Kind; path: string; issues: SchemaIssue[] };

export type LoadedThresholds = Record<Kind, LoadedThresholdsFile>;

/** Fingerprint of the current run compared with `generated` of a thresholds file (09-REQ-04). */
export interface RunSource {
  /** browserName of the measured projects. */
  browsers: string[];
  playwrightVersion: string;
  host: HostFingerprint;
  /** Normalization fingerprint (07-REQ-21). */
  normalization: string;
  /** Step normalization fingerprint (06-REQ-25); null when measure.steps is off. */
  stepNormalization: string | null;
  /** measure.coldSamples of the run (08-REQ-41); undefined: not compared. */
  coldSamples?: number;
}

/** The source as seen by the thresholds file of one kind: its own fingerprint (09-REQ-31). */
export function sourceForKind(source: RunSource, kind: Kind): RunSource {
  return kind === 'step' ? { ...source, normalization: source.stepNormalization ?? '' } : source;
}

export interface EvaluateOptions {
  mode: 'test' | 'thresholds';
  env: string | null;
  /** Tool errors raised earlier in the reporter that make evaluation impossible. */
  fatalToolError: boolean;
  /** Fingerprint of the current run for 09-REQ-04. */
  source: RunSource;
  /** Run start (RunReport.startedAt, ISO UTC); reference date for muting (09-REQ-26). */
  startedAt: string;
  /** Completed passes of the run, for the workload comparison (09-REQ-40); default 1. */
  passes?: number;
  /** Effective workers of the run (09-REQ-40); default 1. */
  workers?: number;
}

export type EvaluationStatus = RunReport['evaluation']['status'];

/**
 * Result of evaluate(). Fits RunReportInput.evaluation; `warnings` and `toolErrors` are merged
 * by the caller into the run warnings and tool errors (02, chapter 9.1).
 */
export interface Evaluation {
  status: EvaluationStatus;
  gateEnabled: boolean;
  counts: Record<Kind, EvaluationCounts>;
  perKey: Record<Kind, Record<string, EvaluatedKey>>;
  thresholdFiles: ThresholdFileInfo[];
  warnings: Issue[];
  /** Issues of invalid thresholds files (09-REQ-02); they belong to the run's toolErrors. */
  toolErrors: Issue[];
}
