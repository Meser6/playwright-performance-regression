// Pass files (02-REQ-36, D-39): every pass of a run with several passes writes the inputs of its
// aggregator and the counters of its end-of-run warnings to <report.dir>/pass-<k>.json; the first
// pass replays them. An internal format: written and read by the same package version in one run,
// so it has no schema file and no migration (like the sample batch, 02-REQ-13). Pure.
import { Aggregator } from '../core/stats/index.ts';
import type { EnrichedRequestSample, EnrichedStepSample, TestMeta } from '../core/stats/index.ts';
import type { Issue, RunReport } from '../core/types/index.ts';

export const PASS_FILE_FORMAT = 'pw-perf-pass';
export const PASS_FILE_VERSION = 1;

/** File name of pass k in report.dir. */
export function passFileName(index: number): string {
  return `pass-${String(index)}.json`;
}

/** pass-<k>.json names, for the clean-up at the start of a run (02-REQ-36). */
export function isPassFileName(name: string): boolean {
  return /^pass-[1-9][0-9]*\.json$/u.test(name);
}

/** One aggregator call, in call order; 'p' is the start of a pass (08-REQ-41, 17-REQ-10). */
export type PassEntry =
  | ['r', string, EnrichedRequestSample, string | null, string | null, string | null]
  | ['s', EnrichedStepSample]
  | ['e', TestMeta]
  | ['p'];

export type TestCounts = Omit<RunReport['tests'], 'status'>;

/** Data of the end-of-run warnings (09, chapter 12.1). */
export interface PassCounters {
  testsStarted: number;
  /** Tests without a batch, test id → file (09-REQ-34). */
  notInstrumented: Record<string, string>;
  crashedTests: Record<string, string>;
  withArtifacts: number;
  instrumentedProjects: string[];
  projectsWithRequests: string[];
  /** Measured projects with browser request samples (02-REQ-42); the rest had request calls only. */
  projectsWithBrowserRequests?: string[];
  pending: Record<string, number>;
}

export interface PassFile {
  format: typeof PASS_FILE_FORMAT;
  schemaVersion: typeof PASS_FILE_VERSION;
  toolVersion: string;
  runId: string;
  pass: { index: number; total: number };
  startedAt: string;
  finishedAt: string;
  status: RunReport['tests']['status'];
  tests: TestCounts;
  counters: PassCounters;
  /** Warnings and tool errors found in this pass after onBegin. */
  warnings: Issue[];
  toolErrors: Issue[];
  entries: PassEntry[];
}

/**
 * An aggregator that also records its inputs for the pass file while `journal` is set. Raw URLs
 * stay out of the file unless report.rawUrls needs them (02-REQ-16).
 */
export class JournalAggregator extends Aggregator {
  journal: PassEntry[] | null = null;
  private readonly keepUrls: boolean;

  constructor(options: ConstructorParameters<typeof Aggregator>[0]) {
    super(options);
    this.keepUrls = options.rawUrls;
  }

  override addRequest(
    key: string,
    sample: EnrichedRequestSample,
    origin: string | null,
    label: string | null,
    browserName: string | null,
  ): void {
    super.addRequest(key, sample, origin, label, browserName);
    this.journal?.push([
      'r',
      key,
      this.keepUrls ? sample : { ...sample, url: '' },
      origin,
      label,
      browserName,
    ]);
  }

  override addStep(sample: EnrichedStepSample): void {
    super.addStep(sample);
    this.journal?.push(['s', sample]);
  }

  override endResult(meta: TestMeta): void {
    super.endResult(meta);
    this.journal?.push(['e', meta]);
  }

  override startSegment(): void {
    super.startSegment();
    this.journal?.push(['p']);
  }
}

/** Replays the entries of a pass into the aggregator, in order (04-REQ-64). */
export function replayEntries(aggregator: Aggregator, entries: readonly PassEntry[]): void {
  for (const entry of entries) {
    if (entry[0] === 'r') aggregator.addRequest(entry[1], entry[2], entry[3], entry[4], entry[5]);
    else if (entry[0] === 's') aggregator.addStep(entry[1]);
    else if (entry[0] === 'e') aggregator.endResult(entry[1]);
    else aggregator.startSegment();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The pass file of pass `index`, or the reason it is not accepted (02-REQ-36): another format,
 * version, package version, run id or pass number, or no valid JSON.
 */
export function parsePassFile(
  text: string,
  expected: { toolVersion: string; runId: string; index: number; total: number },
): { ok: true; value: PassFile } | { ok: false; reason: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'the file is not valid JSON' };
  }
  if (!isRecord(value) || value.format !== PASS_FILE_FORMAT) {
    return { ok: false, reason: 'the file is no pass file' };
  }
  if (value.schemaVersion !== PASS_FILE_VERSION || value.toolVersion !== expected.toolVersion) {
    return { ok: false, reason: 'the file was written by another package version' };
  }
  if (value.runId !== expected.runId) {
    return { ok: false, reason: `the file belongs to run ${JSON.stringify(value.runId)}` };
  }
  const pass = value.pass;
  if (!isRecord(pass) || pass.index !== expected.index || pass.total !== expected.total) {
    return { ok: false, reason: 'the file belongs to another pass' };
  }
  if (
    !Array.isArray(value.entries) ||
    !isRecord(value.tests) ||
    !isRecord(value.counters) ||
    !Array.isArray(value.warnings) ||
    !Array.isArray(value.toolErrors)
  ) {
    return { ok: false, reason: 'the file is incomplete' };
  }
  return { ok: true, value: value as unknown as PassFile };
}

const STATUS_ORDER: RunReport['tests']['status'][] = [
  'passed',
  'failed',
  'timedout',
  'interrupted',
];

/** The worse of two run statuses: interrupted > timedout > failed > passed (04-REQ-64). */
export function worseStatus(
  a: RunReport['tests']['status'],
  b: RunReport['tests']['status'],
): RunReport['tests']['status'] {
  return STATUS_ORDER.indexOf(b) > STATUS_ORDER.indexOf(a) ? b : a;
}
