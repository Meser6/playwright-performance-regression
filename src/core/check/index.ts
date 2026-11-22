// The check mode (04, chapter 4.11): random hosts and the time estimates (also of the start
// banner, 04-REQ-66).
export { estimateText, formatDuration, msPerTest, startEstimate } from './estimate.ts';
export type { EstimateInput } from './estimate.ts';
export { proposePattern, randomHostIssue } from './random-host.ts';
export type { OriginCandidate } from './random-host.ts';
