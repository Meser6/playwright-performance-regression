// Derivation of the thresholds files from a run report (10, chapters 3–8).
import type { ResolvedConfig } from '../config/index.ts';
import { sourceForKind } from '../evaluate/index.ts';
import type { LoadedThresholds, LoadedThresholdsFile, RunSource } from '../evaluate/index.ts';
import { compareText, majorMinor, plural, sameList, sourceDifferences } from '../evaluate/files.ts';
import { stringifyStable } from '../format/index.ts';
import { SCHEMA_VERSIONS, schemaIssueToIssue } from '../schema/index.ts';
import type {
  AggregateStats,
  Generated,
  Issue,
  Kind,
  Result,
  RunReport,
  ThresholdsEntry,
  ThresholdsFile,
} from '../types/index.ts';
import { CLI_COMMAND, KINDS, PACKAGE_NAME } from '../types/index.ts';
import { entrySelfConsistent } from './consistency.ts';
import { isComplete, loosenedMuch, withinHysteresis } from './entries.ts';
import { deriveEntry, derivationSettings, isDerivable, minDeriveSamples } from './formulas.ts';
import type { DeriveOptions, DerivedFile, DerivedThresholds } from './types.ts';

const KIND_NOUN: Record<Kind, string> = { api: 'endpoint', step: 'step' };

/** Aggregates of one kind in the report. */
export function aggregatesOf(report: RunReport, kind: Kind): Record<string, AggregateStats> {
  const byKind: Record<Kind, Record<string, AggregateStats>> = {
    api: report.endpoints,
    step: report.steps,
  };
  return byKind[kind];
}

/** Fingerprint of the source report compared with `generated` (09-REQ-04, 10-REQ-11). */
export function reportSource(report: RunReport): RunSource {
  const browsers = report.runConditions.projects
    .filter((p) => p.role === 'measured' && p.browserName !== null)
    .map((p) => p.browserName ?? '');
  const { platform, arch, ci, cpuCount, cpuModel } = report.host;
  return {
    browsers: [...new Set(browsers)].sort(compareText),
    playwrightVersion: report.playwright.version,
    host: { platform, arch, ci, cpuCount, cpuModel },
    normalization: report.normalization,
    stepNormalization: report.stepNormalization,
  };
}

/** Refusals of 10-REQ-13, in the order listed there; null when derivation may proceed. */
function refusal(
  report: RunReport,
  cfg: ResolvedConfig,
  existing: LoadedThresholds,
): Issue[] | null {
  const incomplete: string[] = [];
  if (report.tests.status === 'interrupted' || report.tests.status === 'timedout') {
    incomplete.push(`tests ${report.tests.status}`);
  }
  if (report.toolErrors.length > 0) {
    const codes = [...new Set(report.toolErrors.map((issue) => issue.code))];
    incomplete.push(`tool errors: ${codes.join(', ')}`);
  }
  if (incomplete.length > 0) {
    return [
      {
        code: 'THRESHOLDS_SOURCE_INCOMPLETE',
        message: `The source report is incomplete or untrustworthy (${incomplete.join('; ')}); no thresholds file was written.`,
        hint: `Fix the cause and derive again with \`${CLI_COMMAND} thresholds\`: thresholds are derived from complete runs only.`,
      },
    ];
  }
  if (KINDS.every((kind) => Object.keys(aggregatesOf(report, kind)).length === 0)) {
    return [
      {
        code: 'THRESHOLDS_EMPTY_REPORT',
        message: 'The source report has no samples; no thresholds file was written.',
        hint: 'Check the integration: tests must use the fixtures from withPerfFixtures, and the measure options must not filter out every request.',
      },
    ];
  }
  const derivable = KINDS.some((kind) =>
    Object.values(aggregatesOf(report, kind)).some((stats) => isDerivable(stats, cfg.checks)),
  );
  if (!derivable) {
    return [
      {
        code: 'THRESHOLDS_NOTHING_TO_DERIVE',
        message: `No key has at least ${minDeriveSamples(cfg.checks)} successful samples (checks.time.median.minSamples); no thresholds file was written.`,
        hint: `Run more passes (run.passes.thresholds or PW_PERF_PASSES).`,
      },
    ];
  }
  const invalid = KINDS.flatMap((kind) => {
    const file = existing[kind];
    return file.status === 'invalid' ? file.issues.map(schemaIssueToIssue) : [];
  });
  return invalid.length > 0 ? invalid : null;
}

/** The generated block of a file written now (10-REQ-11). */
function generatedBlock(
  report: RunReport,
  cfg: ResolvedConfig,
  kind: Kind,
  opts: DeriveOptions,
): Generated {
  const source = reportSource(report);
  const sampleCount = Object.values(aggregatesOf(report, kind)).reduce(
    (sum, stats) => sum + stats.successCount,
    0,
  );
  return {
    tool: { name: PACKAGE_NAME, version: opts.toolVersion },
    env: opts.env,
    sourceRunId: report.runId,
    sourceRunStartedAt: report.startedAt,
    sourceSampleCount: sampleCount,
    evaluatedPercentile: cfg.checks.time.percentile.level,
    derivation: derivationSettings(cfg, kind),
    browsers: source.browsers,
    playwrightVersion: source.playwrightVersion,
    host: source.host,
    // The step file carries the step fingerprint (10-REQ-22, 06-REQ-25).
    normalization: kind === 'step' ? (report.stepNormalization ?? '') : source.normalization,
  };
}

/**
 * Fields of `generated` whose change makes the file be written (10-REQ-12, 10-D-20): every field
 * the evaluation compares (09-REQ-04), but not tool, source* or the Playwright patch version.
 */
function generatedChanged(before: Generated, after: Generated): boolean {
  return (
    before.env !== after.env ||
    before.evaluatedPercentile !== after.evaluatedPercentile ||
    stringifyStable(before.derivation) !== stringifyStable(after.derivation) ||
    !sameList(before.browsers, after.browsers) ||
    majorMinor(before.playwrightVersion) !== majorMinor(after.playwrightVersion) ||
    stringifyStable(before.host) !== stringifyStable(after.host) ||
    before.normalization !== after.normalization
  );
}

/** Muting and note of an entry, kept on every recomputation (10-REQ-21). */
function humanFields(entry: ThresholdsEntry): ThresholdsEntry {
  const fields: ThresholdsEntry = {};
  if (entry.note !== undefined) fields.note = entry.note;
  if (entry.gate !== undefined) fields.gate = entry.gate;
  if (entry.until !== undefined) fields.until = entry.until;
  return fields;
}

interface KindResult {
  file: DerivedFile;
  warnings: Issue[];
  loosenedMuch: number;
}

function deriveKind(
  report: RunReport,
  cfg: ResolvedConfig,
  file: Exclude<LoadedThresholdsFile, { status: 'invalid' }>,
  opts: DeriveOptions,
): KindResult {
  const kind = file.kind;
  const aggregates = aggregatesOf(report, kind);
  const keys = Object.keys(aggregates).sort(compareText);
  const derivable = new Set(
    keys.filter((key) => {
      const stats = aggregates[key];
      return stats !== undefined && isDerivable(stats, cfg.checks);
    }),
  );
  const warnings: Issue[] = [];
  if (derivable.size === 0) {
    // 10-REQ-14: the kind is not written; an existing file stays as it is.
    if (keys.length > 0) {
      warnings.push({
        code: 'THRESHOLDS_KIND_SKIPPED',
        message: `No ${KIND_NOUN[kind]} key has at least ${minDeriveSamples(cfg.checks)} successful samples; ${file.path} was not written.`,
        hint: `Run more passes (run.passes.thresholds or PW_PERF_PASSES).`,
      });
    }
    return { file: { kind, content: null, changed: false }, warnings, loosenedMuch: 0 };
  }

  const loaded = file.status === 'loaded' ? file : null;
  if (loaded !== null && loaded.file.generated === null) {
    warnings.push({
      code: 'THRESHOLDS_MANUAL_FILE',
      message: `${loaded.path} was written by hand (generated: null); its complete entries that are not locked are recomputed.`,
      hint: 'Mark entries you want to keep as they are with "locked": true.',
    });
  }
  if (loaded !== null && loaded.file.generated !== null) {
    const {
      diffs,
      timing,
      keys: keysDiffer,
    } = sourceDifferences(loaded.file.generated, sourceForKind(reportSource(report), kind));
    if (diffs.length > 0) {
      const hints: string[] = [];
      if (timing) {
        hints.push(
          `Deriving on another machine, browser or Playwright version shifts all limits at once: derive on the CI infrastructure that evaluates the runs (\`${CLI_COMMAND} thresholds --from\` with the report from CI).`,
        );
      }
      if (keysDiffer) {
        hints.push(
          `Another normalization changes the keys: entries of old keys are kept as unseen until removed with \`${CLI_COMMAND} thresholds --prune\`.`,
        );
      }
      warnings.push({
        code: 'THRESHOLDS_SOURCE_MISMATCH',
        message: `Thresholds in ${loaded.path} were derived under other conditions than the source report (file / source report): ${diffs.join('; ')}.`,
        hint: hints.join(' '),
      });
    }
  }

  // Existing entries (10-REQ-07), then new keys.
  const before = loaded?.file.entries ?? {};
  const entries: Record<string, ThresholdsEntry> = {};
  let much = 0;
  for (const key of Object.keys(before).sort(compareText)) {
    const old = before[key];
    if (old === undefined) continue;
    const stats = Object.hasOwn(aggregates, key) ? aggregates[key] : undefined;
    if (old.locked === true || !isComplete(old)) {
      // Locked or incomplete: kept byte for byte, also with --prune (10-REQ-07, 10-REQ-08).
      entries[key] = structuredClone(old);
      continue;
    }
    if (stats === undefined) {
      // Unseen: kept unless --prune (10-REQ-10).
      if (!opts.prune) entries[key] = structuredClone(old);
      continue;
    }
    if (!derivable.has(key) || cfg.thresholds.update === 'new-only') {
      entries[key] = structuredClone(old);
      continue;
    }
    const fresh = deriveEntry(stats, kind, cfg);
    // Hysteresis (10-REQ-18): keep the whole entry when it is close and still self-consistent.
    if (
      withinHysteresis(old, fresh, cfg.thresholds.hysteresis) &&
      entrySelfConsistent(old, stats, kind, cfg)
    ) {
      entries[key] = structuredClone(old);
      continue;
    }
    entries[key] = { ...fresh, ...humanFields(old) };
    if (loosenedMuch(old, fresh, cfg.thresholds.loosenWarnRelative)) much += 1;
  }
  for (const key of derivable) {
    const stats = aggregates[key];
    if (Object.hasOwn(before, key) || stats === undefined) continue;
    entries[key] = deriveEntry(stats, kind, cfg);
  }

  const generated = generatedBlock(report, cfg, kind, opts);
  const content: ThresholdsFile = {
    schemaVersion: SCHEMA_VERSIONS.thresholds,
    kind,
    generated,
    entries: Object.fromEntries(
      Object.keys(entries)
        .sort(compareText)
        .map((key) => [key, entries[key] ?? {}]),
    ),
  };
  const changed =
    loaded === null ||
    loaded.migratedFrom !== undefined ||
    loaded.file.generated === null ||
    stringifyStable(loaded.file.entries) !== stringifyStable(content.entries) ||
    generatedChanged(loaded.file.generated, generated);
  return {
    file: { kind, content: changed ? content : structuredClone(loaded.file), changed },
    warnings,
    loosenedMuch: much,
  };
}

/**
 * New content of the thresholds files of both kinds (10, chapter 10). Pure (10-REQ-12): no clock,
 * no randomness; the same report, config and existing files give identical bytes. The caller
 * reads the existing files (as in 09-REQ-01), writes the changed ones and reports the diff.
 */
export function deriveThresholds(
  report: RunReport,
  cfg: ResolvedConfig,
  existing: LoadedThresholds,
  opts: DeriveOptions,
): Result<DerivedThresholds, Issue> {
  for (const kind of KINDS) {
    const found: string = existing[kind].kind;
    if (found !== kind) {
      throw new Error(`deriveThresholds: existing.${kind} has kind "${found}"`);
    }
  }
  const refused = refusal(report, cfg, existing);
  if (refused !== null) return { ok: false, issues: refused };

  const warnings: Issue[] = [];
  if (report.env !== opts.env) {
    const show = (v: string | null): string => (v === null ? 'none' : `"${v}"`);
    warnings.push({
      code: 'THRESHOLDS_ENV_MISMATCH',
      message: `The source report was recorded for environment ${show(report.env)}, but the thresholds are written for environment ${show(opts.env)}.`,
      hint: 'Check the --env flag and run.env: the files are written for the current environment label.',
    });
  }
  if (report.tests.unexpected > 0) {
    warnings.push({
      code: 'THRESHOLDS_SOURCE_TESTS_FAILED',
      message: `The source report has ${plural(report.tests.unexpected, 'failed test execution')}; samples of failed tests may raise the thresholds.`,
      hint: 'Review the diff before committing, or fix the tests and derive again.',
    });
  }
  if (report.mode === 'test') {
    warnings.push({
      code: 'THRESHOLDS_SOURCE_TEST_MODE',
      message:
        'The source report comes from test mode, which runs fewer repetitions than a thresholds run.',
      hint: `Prefer a report of \`${CLI_COMMAND} thresholds\` as the source.`,
    });
  }

  const files: DerivedFile[] = [];
  let much = 0;
  for (const kind of KINDS) {
    const file = existing[kind];
    if (file.status === 'invalid') throw new Error('deriveThresholds: unreachable invalid file');
    // A kind other than api without keys and without a file is left out of the result and the
    // diff, e.g. steps while measure.steps is off (10-REQ-22).
    if (kind !== 'api' && file.status === 'missing') {
      if (Object.keys(aggregatesOf(report, kind)).length === 0) continue;
    }
    const result = deriveKind(report, cfg, file, opts);
    files.push(result.file);
    warnings.push(...result.warnings);
    much += result.loosenedMuch;
  }
  if (much > 0) {
    const percent = Math.round(cfg.thresholds.loosenWarnRelative * 100);
    warnings.push({
      code: 'THRESHOLDS_LOOSENED_MUCH',
      message: `${plural(much, 'entry has', 'entries have')} a time limit that grew by more than ${percent}% in this derivation.`,
      hint: 'Check that the new thresholds do not accept a regression; the entries are marked with ! in the diff.',
    });
  }
  return { ok: true, value: { files, warnings } };
}
