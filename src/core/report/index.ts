// Building the run report (02, chapter 9.1). buildOutcome is in core/evaluate (09-REQ-25).
export { buildRunReport } from './build-run-report.ts';
export type {
  RunReportAggregates,
  RunReportEvaluation,
  RunReportInput,
} from './build-run-report.ts';
export { collapseIssues } from './issues.ts';
