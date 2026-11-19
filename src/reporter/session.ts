// One perf-mode run as the reporter sees it (01, chapters 3.3 and 4.6): onBegin collects the run
// conditions, onTestEnd aggregates the sample batches, onEnd evaluates, writes the run report,
// the thresholds files in thresholds mode and the outcome file, and prints the summary. Free of
// Node and Playwright imports: files, clock and terminal come from the ReporterHost.
import { resolveConfig } from '../core/config/index.ts';
import type { ResolvedConfig, ResolvedConfigJson } from '../core/config/index.ts';
import { assessRun, buildOutcome, evaluate } from '../core/evaluate/index.ts';
import type { LoadedThresholds, RunSource } from '../core/evaluate/index.ts';
import {
  createKeyBuilder,
  detectKeyExplosion,
  measuredBaseOrigins,
  normalizationFingerprint,
} from '../core/normalize/index.ts';
import type { KeySample, KeyResult } from '../core/normalize/index.ts';
import { buildRunReport } from '../core/report/index.ts';
import type { RunReportInput } from '../core/report/index.ts';
import { SCHEMA_VERSIONS, parseSampleBatch, schemaIssueToIssue } from '../core/schema/index.ts';
import { Aggregator, addKeyedRequest } from '../core/stats/index.ts';
import type { Aggregates } from '../core/stats/index.ts';
import {
  deriveThresholds,
  diffThresholds,
  formatThresholdsDiffMarkdown,
} from '../core/thresholds/index.ts';
import type { ThresholdsDiff } from '../core/thresholds/index.ts';
import { PACKAGE_NAME, SAMPLES_ATTACHMENT_NAME } from '../core/types/index.ts';
import type { Issue, Outcome, RunReport } from '../core/types/index.ts';
import { formatSummary } from '../console/summary.ts';
import { formatThresholdsDiff } from '../console/thresholds-diff.ts';
import { generateRunId, readModeState } from '../mode/index.ts';
import type { PerfModeState } from '../mode/index.ts';
import { notWrappedWarning } from '../registry/index.ts';
import type { RegisteredState, RunConditions } from '../registry/index.ts';
import {
  duplicateBaseUrlLabels,
  executionsLine,
  overriddenLine,
  readRunConditions,
  runConditionsWarning,
} from './begin.ts';
import type { RunConditionsReport } from './begin.ts';
import { hasTraceOrVideo, projectName, sampleAttachments, testMeta } from './samples.ts';
import type {
  ConfigLike,
  FullResultLike,
  ReporterHost,
  ResultLike,
  RootSuiteLike,
  TestLike,
} from './types.ts';

/** Keys listed in COLLECTOR_REQUESTS_PENDING (09, chapter 12.1). */
const PENDING_TOP_KEYS = 5;
/** Terminal width without a terminal (09-REQ-22). */
const DEFAULT_WIDTH = 120;

/** What the reporter runs with: the registered state of withPerf(), or the defaults. */
export interface RunSettings {
  config: ResolvedConfig;
  snapshot: ResolvedConfigJson;
  mode: PerfModeState;
  packageVersion: string;
  /** Measured project names; null measures every project (no withPerf(), 01-REQ-07). */
  measuredProjects: string[] | null;
  runConditions: RunConditions;
  /** withPerf() was applied: the run conditions are checked (04-REQ-19). */
  registered: boolean;
  /** Warnings found before the run: withPerf(), or NOT_WRAPPED_WITH_PERF. */
  warnings: Issue[];
  /** Problems that make the run result untrustworthy, e.g. an invalid PW_PERF_* value. */
  toolErrors: Issue[];
}

/**
 * Settings of the run (01-REQ-07): the registered state, or in perf mode without withPerf() the
 * default config with every project measured and one NOT_WRAPPED_WITH_PERF warning. Null when
 * perf mode is off: the reporter then does nothing (P-02).
 */
export function runSettings(
  registered: RegisteredState | undefined,
  env: Readonly<Record<string, string | undefined>>,
  packageVersion: string,
): RunSettings | null {
  if (registered !== undefined) {
    return {
      config: registered.config,
      snapshot: registered.snapshot,
      mode: registered.mode,
      packageVersion: registered.packageVersion,
      measuredProjects: registered.measuredProjects,
      runConditions: registered.runConditions,
      registered: true,
      warnings: [...registered.warnings],
      toolErrors: [],
    };
  }
  const read = readModeState(env);
  if (read.ok && read.value === null) return null;
  const mode: PerfModeState = read.ok && read.value !== null ? read.value : { mode: 'test' };
  const resolved = resolveConfig(undefined, {
    mode: mode.mode,
    ...(mode.repeat === undefined ? {} : { repeat: mode.repeat }),
    ...(mode.env === undefined ? {} : { env: mode.env }),
  });
  if (!resolved.ok) throw new Error('the default package config is not valid');
  return {
    config: resolved.value.config,
    snapshot: resolved.value.snapshot,
    mode,
    packageVersion,
    measuredProjects: null,
    runConditions: { overridden: [], removedProjects: [], removedReporters: [] },
    registered: false,
    warnings: [notWrappedWarning()],
    toolErrors: read.ok ? [] : read.issues,
  };
}

function internalError(where: string, error: unknown): Issue {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return {
    code: 'REPORTER_INTERNAL_ERROR',
    message: `Unexpected error in the reporter (${where}): ${text}`,
    hint: 'This is a bug in the package; please report it with the message above.',
  };
}

function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

/** Options the reporter could get later; the HTML report is rendered by WP-13. */
export interface SessionOptions {
  /** Renders report.html from the run report; while unset no HTML file is written. */
  renderHtml?: ((report: RunReport) => string) | undefined;
}

export class RunSession {
  private readonly host: ReporterHost;
  private readonly settings: RunSettings;
  private readonly options: SessionOptions;
  private readonly warnings: Issue[];
  private readonly toolErrors: Issue[];
  private startedAt: Date;
  private runId: string;
  private configDir: string;
  private maxFailures = 0;
  private measured: ReadonlySet<string> = new Set();
  private conditions: RunConditionsReport;
  private normalization: string;
  private aggregator: Aggregator;
  private keyOf: (sample: KeySample) => KeyResult;
  /** onBegin failed: the evaluation is not possible. */
  private fatal = false;
  private testsStarted = 0;
  private readonly testsSeen = new Set<TestLike>();
  private notInstrumented = 0;
  private retried = 0;
  private withArtifacts = 0;
  private readonly pending = new Map<string, number>();
  private playwrightVersion = '';

  constructor(host: ReporterHost, settings: RunSettings, options: SessionOptions = {}) {
    this.host = host;
    this.settings = settings;
    this.options = options;
    this.warnings = [...settings.warnings];
    this.toolErrors = [...settings.toolErrors];
    this.startedAt = host.now();
    this.runId = settings.mode.runId ?? generateRunId(this.startedAt, host.random);
    this.configDir = host.cwd;
    this.conditions = { workers: 1, projects: [], overriddenSettings: [] };
    const keys = settings.config.keys;
    this.normalization = normalizationFingerprint(keys, { baseOrigins: [] });
    this.aggregator = this.createAggregator();
    this.keyOf = createKeyBuilder(keys, { baseOrigins: [] });
  }

  private get mode(): 'test' | 'thresholds' {
    return this.settings.mode.mode;
  }

  private get repeat(): number {
    return this.settings.config.run.repeat[this.mode];
  }

  private createAggregator(): Aggregator {
    const cfg = this.settings.config;
    return new Aggregator({
      advanced: cfg.advanced,
      successStatuses: cfg.measure.successStatuses,
      errors: cfg.checks.errors,
      measuredProjects: this.measured,
      evaluatedPercentile: cfg.checks.time.percentile.level,
      rawUrls: cfg.report.rawUrls,
    });
  }

  private info(line: string): void {
    this.host.stdout.write(`${PACKAGE_NAME}: ${line}\n`);
  }

  /** A hook threw: the error goes to the report and the outcome file (01-REQ-16). */
  recordInternalError(where: string, error: unknown): void {
    this.toolErrors.push(internalError(where, error));
    if (where === 'onBegin') this.fatal = true;
  }

  begin(config: ConfigLike, suite: RootSuiteLike): void {
    this.playwrightVersion = config.version;
    this.startedAt = this.host.now();
    if (this.settings.mode.runId === undefined) {
      this.runId = generateRunId(this.startedAt, this.host.random);
    }
    const io = this.host.io;
    this.configDir =
      config.configFile === undefined ? config.rootDir : io.directoryOf(config.configFile);
    this.maxFailures = config.maxFailures;
    const names = this.settings.measuredProjects ?? config.projects.map((p) => p.name);
    this.measured = new Set(names);
    this.conditions = readRunConditions(
      config,
      this.measured,
      this.settings.runConditions.overridden,
    );

    // Keys and the fingerprint depend on the baseURL origins of measured projects (07-REQ-20).
    const baseOrigins = measuredBaseOrigins(
      this.conditions.projects.map((p, i) => ({
        role: p.role,
        baseURL: config.projects[i]?.use.baseURL,
      })),
    );
    const keys = this.settings.config.keys;
    this.normalization = normalizationFingerprint(keys, { baseOrigins });
    this.keyOf = createKeyBuilder(keys, { baseOrigins });
    this.aggregator = this.createAggregator();

    if (this.settings.registered) {
      const changed = runConditionsWarning(this.conditions, this.repeat);
      if (changed !== null) this.warnings.push(changed);
    }
    const duplicate = duplicateBaseUrlLabels(this.conditions, config, keys);
    if (duplicate !== null) this.warnings.push(duplicate);
    if (config.shard !== null) {
      // 04-REQ-34: each shard would evaluate part of the keys and write partial thresholds.
      this.toolErrors.push({
        code: 'RUN_SHARDED',
        message: `The perf-mode run is sharded (--shard ${config.shard.current}/${config.shard.total}): each machine would evaluate only part of the keys.`,
        hint: 'Run perf mode on one machine without --shard.',
      });
    }

    const overridden = overriddenLine(this.settings.runConditions);
    if (overridden !== null) this.info(overridden);
    this.info(
      executionsLine(this.mode, suite.allTests(), this.measured, this.repeat, config.workers),
    );
  }

  testBegin(): void {
    this.testsStarted += 1;
  }

  testEnd(test: TestLike, result: ResultLike): void {
    this.testsSeen.add(test);
    if (result.retry > 0) this.retried += 1;
    if (hasTraceOrVideo(result)) this.withArtifacts += 1;

    const bodies = sampleAttachments(result);
    const measured = this.measured.has(projectName(test));
    if (bodies.length === 0) {
      // Every test of a measured project has a batch, also an empty one (01-REQ-18).
      if (measured && result.status !== 'skipped') this.notInstrumented += 1;
      return;
    }
    const meta = testMeta(
      test,
      result,
      this.host.io.relativeSlashPath(this.configDir, test.location.file),
    );
    if (bodies.length > 1) {
      this.warnings.push({
        code: 'ATTACHMENT_DUPLICATE',
        message: `Test "${meta.title}" has ${bodies.length} ${SAMPLES_ATTACHMENT_NAME} attachments; all of them were processed.`,
        hint: 'Apply withPerfFixtures() once per test object.',
      });
    }
    for (const body of bodies) {
      const parsed = parseSampleBatch(body, meta.title);
      if (!parsed.ok) {
        // The attachment is skipped (01, chapter 8; 02-AC-13).
        this.toolErrors.push(...parsed.issues.map(schemaIssueToIssue));
        continue;
      }
      const batch = parsed.value;
      this.warnings.push(...batch.diagnostics);
      batch.requests.forEach((sample, ordinal) => {
        const keyed = addKeyedRequest(
          this.aggregator,
          this.keyOf,
          { ...sample, test: meta, ordinal },
          batch.collector.browserName,
        );
        this.warnings.push(...keyed.issues);
        if (keyed.ok && sample.status === 'PENDING' && measured) {
          this.pending.set(keyed.key, (this.pending.get(keyed.key) ?? 0) + 1);
        }
      });
      batch.custom.forEach((sample, ordinal) => {
        this.aggregator.addCustom(sample.name, { ...sample, test: meta, ordinal });
      });
    }
  }

  /** Warnings known only at the end of the run (09, chapter 12.1). */
  private runWarnings(): Issue[] {
    const issues: Issue[] = [];
    if (this.notInstrumented > 0) {
      issues.push({
        code: 'TESTS_NOT_INSTRUMENTED',
        message: `${plural(this.notInstrumented, 'test result')} of measured projects ${this.notInstrumented === 1 ? 'has' : 'have'} no ${SAMPLES_ATTACHMENT_NAME} attachment, so ${this.notInstrumented === 1 ? 'it was' : 'they were'} not measured.`,
        hint: 'Import test from a test object wrapped with withPerfFixtures() (or from "playwright-performance-regression/test"); a crashed worker also loses the attachment.',
      });
    }
    if (this.retried > 0) {
      issues.push({
        code: 'RUN_CONDITIONS_CHANGED',
        message: `${plural(this.retried, 'test result is a retry', 'test results are retries')} (retry > 0), although perf mode sets retries to 0; samples of retries are counted.`,
        hint: 'Remove retries set in test files (test.describe.configure({ retries })) for perf-mode runs.',
      });
    }
    if (this.withArtifacts > 0) {
      issues.push({
        code: 'RUN_CONDITIONS_CHANGED',
        message: `${plural(this.withArtifacts, 'test result has', 'test results have')} a trace or video attachment, although perf mode turns them off; recording slows the browser down.`,
        hint: 'Remove test.use({ trace, video }) from test files for perf-mode runs.',
      });
    }
    return issues;
  }

  private pendingWarning(): Issue | null {
    if (this.pending.size === 0) return null;
    let total = 0;
    for (const n of this.pending.values()) total += n;
    const top = [...this.pending]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .slice(0, PENDING_TOP_KEYS)
      .map(([key, n]) => `${key} (${n})`);
    return {
      code: 'COLLECTOR_REQUESTS_PENDING',
      message: `${plural(total, 'request was', 'requests were')} still pending at the end of a test; most in: ${top.join(', ')}.`,
      hint: 'Exclude long polling and streaming with measure.exclude, or raise measure.pendingTimeoutMs.',
    };
  }

  private testsResult(status: FullResultLike['status']): RunReport['tests'] {
    const tests = { status, expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
    for (const test of this.testsSeen) tests[test.outcome()] += 1;
    return tests;
  }

  private source(): RunSource {
    const browsers = this.conditions.projects
      .filter((p) => p.role === 'measured' && p.browserName !== null)
      .map((p) => p.browserName as string);
    const { nodeVersion: _, ...host } = this.host.host;
    return {
      browsers: [...new Set(browsers)].sort(),
      playwrightVersion: this.playwrightVersion,
      host,
      normalization: this.normalization,
    };
  }

  private reportInput(
    status: FullResultLike['status'],
    finishedAt: Date,
    aggregates: Aggregates,
    evaluation: ReturnType<typeof evaluate>,
    warnings: Issue[],
    toolErrors: Issue[],
  ): RunReportInput {
    return {
      meta: {
        tool: { name: PACKAGE_NAME, version: this.settings.packageVersion },
        runId: this.runId,
        mode: this.mode,
        startedAt: this.startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        env: this.settings.config.run.env,
        configDir: this.configDir,
        ci: this.host.ci,
        host: this.host.host,
        playwright: { version: this.playwrightVersion },
      },
      config: this.settings.snapshot,
      normalization: this.normalization,
      runConditions: this.conditions,
      tests: this.testsResult(status),
      aggregates,
      evaluation,
      warnings,
      toolErrors,
    };
  }

  private terminal(): { width: number; color: boolean } {
    const out = this.host.stdout;
    const noColor = (this.host.env.NO_COLOR ?? '') !== '';
    return {
      width:
        out.isTTY === true && out.columns !== undefined && out.columns > 0
          ? out.columns
          : DEFAULT_WIDTH,
      color: out.isTTY === true && !noColor,
    };
  }

  /**
   * onEnd (01, chapter 3.3, steps 8–9). Returns the status for Playwright: `failed` when the
   * outcome exit code is not 0, otherwise nothing, so Playwright keeps its own (01-REQ-17).
   */
  async end(result: FullResultLike): Promise<{ status?: FullResultLike['status'] } | undefined> {
    // --list, or a filter that selected no test: no report, no outcome, no status (01-REQ-40).
    if (this.testsStarted === 0) return undefined;
    let outcome: Outcome;
    try {
      outcome = await this.finish(result);
    } catch (error) {
      this.recordInternalError('onEnd', error);
      outcome = this.fallbackOutcome(result);
      for (const issue of outcome.toolErrors) {
        this.host.stderr.write(`${PACKAGE_NAME}: ${issue.code}: ${issue.message}\n`);
      }
    }
    await this.writeOutcome(outcome);
    return outcome.exitCode === 0 ? undefined : { status: 'failed' };
  }

  private async finish(result: FullResultLike): Promise<Outcome> {
    const cfg = this.settings.config;
    const io = this.host.io;
    const finishedAt = this.host.now();
    const warnings = [...this.warnings, ...this.runWarnings()];
    const toolErrors = [...this.toolErrors];

    const aggregates = this.aggregator.finalize();
    warnings.push(...aggregates.issues, ...detectKeyExplosion(Object.keys(aggregates.endpoints)));
    const pending = this.pendingWarning();
    if (pending !== null) warnings.push(pending);
    const tests = this.testsResult(result.status);
    const assessment = assessRun(
      { tests, maxFailures: this.maxFailures, sharded: false },
      cfg.gate,
    );
    warnings.push(...assessment.warnings);
    toolErrors.push(...assessment.toolErrors);

    const location = {
      configDir: this.configDir,
      dir: cfg.thresholds.dir,
      filePrefix: cfg.thresholds.filePrefix,
      env: cfg.run.env,
    };
    const loaded = await io.loadThresholds(location);
    const evaluation = evaluate(aggregates, loaded, cfg, {
      mode: this.mode,
      env: cfg.run.env,
      fatalToolError: this.fatal,
      source: this.source(),
      startedAt: this.startedAt.toISOString(),
    });
    warnings.push(...evaluation.warnings);
    toolErrors.push(...evaluation.toolErrors);
    const build = (): RunReport =>
      buildRunReport(
        this.reportInput(result.status, finishedAt, aggregates, evaluation, warnings, toolErrors),
      );
    let report = build();

    const reportDir = io.resolvePath(this.configDir, cfg.report.dir);
    const paths: Outcome['paths'] = {
      reportJson: null,
      reportHtml: null,
      thresholds: [],
      thresholdsDiff: null,
    };

    // Thresholds mode: derive from this report, write changed files and the diff (10).
    let diffs: ThresholdsDiff[] = [];
    let diffPaths: string[] = [];
    if (this.mode === 'thresholds') {
      const derived = await this.deriveAndWrite(
        report,
        loaded,
        location,
        paths,
        warnings,
        toolErrors,
      );
      diffs = derived.diffs;
      diffPaths = derived.paths;
      report = build();
    }

    try {
      const path = io.resolvePath(reportDir, 'report.json');
      await io.writeJsonStable(path, report);
      paths.reportJson = path;
    } catch (error) {
      toolErrors.push({
        code: 'REPORT_WRITE_FAILED',
        message: `The run report could not be written to ${reportDir}: ${error instanceof Error ? error.message : String(error)}`,
        hint: 'Check that report.dir is writable.',
      });
      report = build();
    }
    if (this.options.renderHtml !== undefined) {
      // Hook for the HTML report (11, WP-13).
      const path = io.resolvePath(reportDir, 'report.html');
      await io.writeTextAtomic(path, this.options.renderHtml(report));
      paths.reportHtml = path;
    }

    const { width, color } = this.terminal();
    this.host.stdout.write(
      formatSummary(report, { width, color, cwd: this.host.cwd, html: paths.reportHtml !== null }),
    );
    if (diffs.length > 0) {
      this.host.stdout.write(
        formatThresholdsDiff(diffs, {
          paths: diffPaths.map((p) => io.relativeSlashPath(this.host.cwd, p)),
          width,
          color,
          prune: this.settings.mode.prune === true,
          diffPath:
            paths.thresholdsDiff === null
              ? null
              : io.relativeSlashPath(this.host.cwd, paths.thresholdsDiff),
        }),
      );
    }
    return buildOutcome(report, paths);
  }

  /**
   * Derivation in thresholds mode (10, chapter 3): refusals and write errors are tool errors, so
   * nothing is written for an incomplete run (04-REQ-36); the diff file failing is a warning.
   * Returns the diffs and the absolute path of each thresholds file.
   */
  private async deriveAndWrite(
    report: RunReport,
    loaded: LoadedThresholds,
    location: Parameters<ReporterHost['io']['thresholdsFilePaths']>[0],
    paths: Outcome['paths'],
    warnings: Issue[],
    toolErrors: Issue[],
  ): Promise<{ diffs: ThresholdsDiff[]; paths: string[] }> {
    const cfg = this.settings.config;
    const io = this.host.io;
    const derived = deriveThresholds(report, cfg, loaded, {
      env: cfg.run.env,
      prune: this.settings.mode.prune === true,
      toolVersion: this.settings.packageVersion,
    });
    if (!derived.ok) {
      toolErrors.push(...derived.issues);
      return { diffs: [], paths: [] };
    }
    warnings.push(...derived.value.warnings);
    const absolute = io.thresholdsFilePaths(location);
    for (const file of derived.value.files) {
      if (file.content === null || !file.changed) continue;
      try {
        await io.writeJsonStable(absolute[file.kind], file.content);
        paths.thresholds.push(absolute[file.kind]);
      } catch (error) {
        toolErrors.push({
          code: 'THRESHOLDS_WRITE_FAILED',
          message: `The thresholds file ${loaded[file.kind].path} could not be written: ${error instanceof Error ? error.message : String(error)}`,
          hint: 'Check that thresholds.dir is writable, then derive the thresholds again.',
        });
      }
    }
    const diffs = derived.value.files.map((file) =>
      diffThresholds(loaded[file.kind], file, report, cfg),
    );
    const filePaths = derived.value.files.map((file) => absolute[file.kind]);
    const diffPath = io.resolvePath(
      io.resolvePath(this.configDir, cfg.report.dir),
      'thresholds-diff.md',
    );
    try {
      await io.writeTextAtomic(
        diffPath,
        formatThresholdsDiffMarkdown(
          diffs,
          derived.value.files.map((file) => loaded[file.kind].path),
        ),
      );
      paths.thresholdsDiff = diffPath;
    } catch (error) {
      warnings.push({
        code: 'THRESHOLDS_DIFF_WRITE_FAILED',
        message: `The thresholds diff could not be written to ${diffPath}: ${error instanceof Error ? error.message : String(error)}`,
        hint: 'The thresholds files are written; check that report.dir is writable.',
      });
    }
    return { diffs, paths: filePaths };
  }

  /** The outcome when building the report failed: exit code 3 with the error (02-REQ-27). */
  private fallbackOutcome(result: FullResultLike): Outcome {
    return {
      schemaVersion: SCHEMA_VERSIONS.outcome,
      runId: this.runId,
      mode: this.mode,
      exitCode: 3,
      tests: { status: result.status },
      evaluation: { status: 'error', gateEnabled: this.mode === 'test' },
      toolErrors: this.toolErrors.map((issue) => ({ ...issue })),
      paths: { reportJson: null, reportHtml: null, thresholds: [], thresholdsDiff: null },
    };
  }

  /** Last step of onEnd (02-REQ-27); without PW_PERF_OUTCOME_FILE there is no outcome file. */
  private async writeOutcome(outcome: Outcome): Promise<void> {
    const file = this.settings.mode.outcomeFile;
    if (file === undefined) return;
    try {
      await this.host.io.writeJsonStable(file, outcome);
    } catch (error) {
      this.host.stderr.write(
        `${PACKAGE_NAME}: OUTCOME_WRITE_FAILED: the outcome file could not be written to ${file}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
}
