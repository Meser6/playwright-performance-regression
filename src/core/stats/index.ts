// Aggregation and statistics (08).
export { Aggregator, addKeyedRequest } from './aggregator.ts';
export type { AggregatorOptions, Aggregates, StatsIssue, StatsIssueCode } from './aggregator.ts';
export { ABORT_FAILURE_TEXTS, compileStatusMatcher, requestStatusLabel } from './classification.ts';
export { WILSON_Z, apdex, apdexCounts, exceedingShare, wilsonBounds } from './functions.ts';
export { isFailedTest, resultId, sampleId, testIdentity } from './identity.ts';
export type {
  EnrichedCustomSample,
  EnrichedRequestSample,
  SampleKind,
  TestMeta,
} from './identity.ts';
export { percentile, percentileNames } from './percentile.ts';
export { BottomK } from './sampling.ts';
