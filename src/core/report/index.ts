// Building the run report (02, chapter 9.1). buildOutcome is in core/evaluate (09-REQ-25).
export { buildRunReport } from './build-run-report.ts';
export type {
  RunReportAggregates,
  RunReportEvaluation,
  RunReportInput,
} from './build-run-report.ts';
export {
  MAX_HINTS,
  NEAR_LIMIT_USAGE,
  TAIL_MEDIAN_USAGE,
  checkUsage,
  keyHeadroom,
  keyHints,
  withUsage,
} from './hints.ts';
export type { HintFacts, HintOptions } from './hints.ts';
export { collapseIssues } from './issues.ts';
