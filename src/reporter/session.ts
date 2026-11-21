// One perf-mode run as the reporter sees it (01, chapters 3.3 and 4.6): onBegin collects the run
// conditions, onTestEnd aggregates the sample batches, onEnd evaluates, writes the run report,
// the thresholds files in thresholds mode and the outcome file, and prints the summary. Free of
// Node and Playwright imports: files, clock and terminal come from the ReporterHost.
import { resolveConfig } from '../core/config/index.ts';
import type { ResolvedConfig, ResolvedConfigJson } from '../core/config/index.ts';
import { assessRun, buildOutcome, evaluate } from '../core/evaluate/index.ts';
import type { LoadedThresholds, RunSource } from '../core/evaluate/index.ts';
import {
  compileHostPatterns,
  coveredByOrigins,
  createKeyBuilder,
  detectKeyExplosion,
  isHostPattern,
  matchingPattern,
  measuredBaseOrigins,
  normalizationFingerprint,
} from '../core/normalize/index.ts';
import type { KeySample, KeyResult } from '../core/normalize/index.ts';
import { buildRunReport, collapseIssues, nextHint, suggestCommand } from '../core/report/index.ts';
import { estimateText, msPerTest, randomHostIssue, startEstimate } from '../core/check/index.ts';
import type { CommandContext, PerfMode, WrittenFile } from '../core/report/index.ts';
import { StepRecorder } from './steps.ts';
import type { RunReportInput } from '../core/report/index.ts';
import {
  SCHEMA_VERSIONS,
  parseRunReport,
  parseSampleBatch,
  schemaIssueToIssue,
} from '../core/schema/index.ts';
import { addKeyedRequest, resultId } from '../core/stats/index.ts';
import type { TestMeta } from '../core/stats/index.ts';
import type { Aggregates } from '../core/stats/index.ts';
import {
  deriveThresholds,
  diffThresholds,
  formatThresholdsDiffMarkdown,
} from '../core/thresholds/index.ts';
import type { ThresholdsDiff } from '../core/thresholds/index.ts';
import { CLI_COMMAND, PACKAGE_NAME, SAMPLES_ATTACHMENT_NAME } from '../core/types/index.ts';
import type { Issue, Outcome, RunReport } from '../core/types/index.ts';
import { stringifyStable } from '../core/format/index.ts';
import { colorEnabled } from '../console/color.ts';
import { nextLine, outcomeLine } from '../console/outcome-line.ts';
import { formatCheckSummary } from '../console/check-summary.ts';
import { asciiTerminal } from '../console/box.ts';
import { formatStartBanner } from '../console/start-banner.ts';
import { formatSummary } from '../console/summary.ts';
import { formatThresholdsDiff } from '../console/thresholds-diff.ts';
import { renderHtmlReport } from '../html/index.ts';
import {
  DEFAULT_MAX_TESTS,
  checkStateFileName,
  generateRunId,
  isCiEnv,
  passCommand,
  readModeState,
  testArgsFromArgv,
  testFilters,
  writeModeState,
} from '../mode/index.ts';
import type { PerfModeState } from '../mode/index.ts';
import { notWrappedWarning } from '../registry/index.ts';
import type { RegisteredState, RunConditions } from '../registry/index.ts';
import {
  duplicateBaseUrlLabels,
  measuredTestCount,
  overriddenLine,
  readRunConditions,
  runConditionsWarning,
} from './begin.ts';
import {
  JournalAggregator,
  isPassFileName,
  parsePassFile,
  passFileName,
  replayEntries,
  worseStatus,
} from './pass-file.ts';
import type { PassFile, TestCounts } from './pass-file.ts';
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
    mode: mode.mode === 'check' ? 'test' : mode.mode,
    ...(mode.mode === 'check'
      ? {}
      : mode.pass !== undefined
        ? { passes: mode.pass.total }
        : mode.passes === undefined
          ? {}
          : { passes: mode.passes }),
    ...(mode.env === undefined ? {} : { env: mode.env }),
  });
  if (!resolved.ok) throw new Error('the default package config is not valid');
  return {
    config: resolved.value.config,
    snapshot: resolved.value.snapshot,
    mode,
    packageVersion,
    measuredProjects: null,
    runConditions: {
      overridden: [],
      removedProjects: [],
      removedReporters: [],
      replacedReporters: [],
    },
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

export interface SessionOptions {
  /** Renders report.html from the run report (11); renderHtmlReport by default. */
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
  private aggregator: JournalAggregator;
  private keyOf: (sample: KeySample) => KeyResult;
  private readonly steps: StepRecorder;
  /** onBegin failed: the evaluation is not possible. */
  private fatal = false;
  private testsStarted = 0;
  private readonly testsSeen = new Set<TestLike>();
  private notInstrumented = 0;
  private withArtifacts = 0;
  /** Test counts of the passes 2…N merged into this one (04-REQ-64). */
  private readonly mergedTests: TestCounts = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  /** Passes merged into the report and passes without data (02-REQ-37). */
  private completedPasses = 1;
  private readonly failedPasses: number[] = [];
  /** Warnings and tool errors before onBegin ended: the same in every pass. */
  private beginWarnings = 0;
  private beginToolErrors = 0;
  /** "n" to the Continue? question (04-REQ-65): the run ends without output. */
  private cancelled = false;
  private readonly pending = new Map<string, number>();
  /** Check (04, chapter 4.11): counters for the output and the estimate. */
  private readonly checkRun = {
    selected: 0,
    ran: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    durations: [] as number[],
    setupMs: 0,
    requests: new Map<string, number>(),
    tests: new Map<string, number>(),
  };
  private configLike: ConfigLike | null = null;
  /** Measured projects with a non-skipped test that has a batch, and those with requests. */
  private readonly instrumentedProjects = new Set<string>();
  private readonly projectsWithRequests = new Set<string>();
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
    this.steps = new StepRecorder(settings.config);
  }

  /** Mode of the run report; a check aggregates like a measurement run (04-REQ-48). */
  private get mode(): 'test' | 'thresholds' {
    const mode = this.settings.mode.mode;
    return mode === 'check' ? 'test' : mode;
  }

  /** A dry run: nothing is evaluated or written (04, chapter 4.11). */
  private get check(): boolean {
    return this.settings.mode.mode === 'check';
  }

  /** Passes of the run (D-39): one in a check, N of PW_PERF_PASS=k/N in passes 2…N. */
  private get passes(): number {
    if (this.check) return 1;
    return this.settings.mode.pass?.total ?? this.settings.config.run.passes[this.mode];
  }

  /** Number of this pass, from 1 (04-REQ-64). */
  private get passIndex(): number {
    return this.check ? 1 : (this.settings.mode.pass?.index ?? 1);
  }

  private createAggregator(): JournalAggregator {
    const cfg = this.settings.config;
    return new JournalAggregator({
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
    this.configLike = config;
    this.startedAt = this.host.now();
    if (this.settings.mode.runId === undefined) {
      this.runId = generateRunId(this.startedAt, this.host.random);
    }
    const io = this.host.io;
    this.configDir =
      config.configFile === undefined ? config.rootDir : io.directoryOf(config.configFile);
    // The outcome of an earlier run must never be read by a CI job (04-REQ-62); pass files of an
    // earlier run must never be merged (02-REQ-36). Passes 2…N leave both alone.
    const outcomeFile = this.outcomePath();
    if (this.passIndex === 1 && this.environmentMode && outcomeFile !== null) {
      try {
        io.removeFileSync(outcomeFile);
      } catch {
        // A file that cannot be removed is overwritten in onEnd.
      }
    }
    if (this.passIndex === 1 && !this.check) this.removePassFiles();
    this.maxFailures = config.maxFailures;
    const names = this.settings.measuredProjects ?? config.projects.map((p) => p.name);
    this.measured = new Set(names);
    this.checkRun.selected = suite
      .allTests()
      .filter((t) => this.measured.has(projectName(t))).length;
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
      const changed = runConditionsWarning(this.conditions);
      if (changed !== null) this.warnings.push(changed);
    }
    const duplicate = duplicateBaseUrlLabels(this.conditions, config, keys);
    if (duplicate !== null) this.warnings.push(duplicate);
    const empty = emptyBaseUrlWarning(this.conditions, config);
    if (empty !== null) this.warnings.push(empty);
    if (config.shard !== null) {
      // 04-REQ-34: each shard would evaluate part of the keys and write partial thresholds.
      this.toolErrors.push({
        code: 'RUN_SHARDED',
        message: `The perf-mode run is sharded (--shard ${config.shard.current}/${config.shard.total}): each machine would evaluate only part of the keys.`,
        hint: 'Run perf mode on one machine without --shard.',
      });
    }

    this.beginWarnings = this.warnings.length;
    this.beginToolErrors = this.toolErrors.length;
    if (this.passes > 1) this.aggregator.journal = [];
    if (this.passIndex > 1) {
      this.info(`pass ${String(this.passIndex)}/${String(this.passes)} (perf mode "${this.mode}")`);
      return;
    }
    const overridden = overriddenLine(this.settings.runConditions);
    if (overridden !== null) this.info(overridden);
    this.host.stdout.write(this.startBanner(suite));
    this.confirm();
  }

  /** report.dir as an absolute path. */
  private reportDir(): string {
    const io = this.host.io;
    return io.resolvePath(this.configDir, this.settings.config.report.dir);
  }

  /** Removes pass-<k>.json files of an earlier run (02-REQ-36). */
  private removePassFiles(): void {
    const io = this.host.io;
    const dir = this.reportDir();
    for (const name of io.listDirSync(dir)) {
      if (!isPassFileName(name)) continue;
      try {
        io.removeFileSync(io.resolvePath(dir, name));
      } catch {
        // A left-over file has another run id and is never merged.
      }
    }
  }

  /** Time per test execution of the last run report in report.dir (04-REQ-66), or null. */
  private lastMsPerTest(): number | null {
    const path = this.host.io.resolvePath(this.reportDir(), 'report.json');
    const text = this.host.io.readTextFileSync(path);
    if (text === null) return null;
    const parsed = parseRunReport(text, path);
    return parsed.ok ? msPerTest(parsed.value) : null;
  }

  /** The start banner (04-REQ-65). */
  private startBanner(suite: RootSuiteLike): string {
    const cfg = this.settings.config;
    const io = this.host.io;
    const tests = measuredTestCount(suite.allTests(), this.measured);
    const file = cfg.report.html ? 'report.html' : 'report.json';
    const { width, color } = this.terminal();
    return formatStartBanner(
      {
        packageName: 'pw-perf',
        mode: this.settings.mode.mode,
        measured: this.conditions.projects.filter((p) => p.role === 'measured').map((p) => p.name),
        dependencies: this.conditions.projects
          .filter((p) => p.role !== 'measured')
          .map((p) => p.name),
        tests,
        passes: this.passes,
        maxTests: this.settings.mode.maxTests ?? DEFAULT_MAX_TESTS,
        estimate: this.check
          ? null
          : startEstimate({ tests, passes: this.passes, msPerTest: this.lastMsPerTest() }),
        report: this.check
          ? null
          : io.relativeSlashPath(this.host.cwd, io.resolvePath(this.reportDir(), file)),
        tip: testFilters(testArgsFromArgv(this.host.argv)).length === 0,
      },
      { width, color, ascii: asciiTerminal(this.host.env) },
    );
  }

  /**
   * "Continue? (Y/n)" in a terminal outside CI, without PW_PERF_YES=1 (04-REQ-65). "n" ends the
   * process with 130.
   */
  private confirm(): void {
    if (this.check || this.settings.mode.yes === true) return;
    if (this.host.stdout.isTTY !== true || this.host.ci !== null || isCiEnv(this.host.env)) return;
    for (;;) {
      const answer = this.host.ask('Continue? (Y/n) ');
      if (answer === null) return;
      const text = answer.trim().toLowerCase();
      if (text === '' || text === 'y' || text === 'yes') return;
      if (text === 'n' || text === 'no') {
        this.cancelled = true;
        this.info('cancelled');
        this.host.exit(130);
        return;
      }
    }
  }

  testBegin(): void {
    this.testsStarted += 1;
  }

  testEnd(test: TestLike, result: ResultLike): void {
    this.testsSeen.add(test);
    if (hasTraceOrVideo(result)) this.withArtifacts += 1;

    const bodies = sampleAttachments(result);
    const measured = this.measured.has(projectName(test));
    if (this.check) this.countCheck(test, result, measured);
    const relative = (file: string): string => this.host.io.relativeSlashPath(this.configDir, file);
    const meta = this.passMeta(testMeta(test, result, relative(test.location.file)), test);
    // Steps come from the result, not from the batch, so they are read without it (06-REQ-16).
    this.steps.record(this.aggregator, test, result.steps, meta, relative);
    if (bodies.length === 0) {
      // Every test of a measured project has a batch, also an empty one (01-REQ-18).
      if (measured && result.status !== 'skipped') this.notInstrumented += 1;
      return;
    }
    const project = projectName(test);
    if (measured && result.status !== 'skipped') {
      this.instrumentedProjects.add(project);
    }
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
      if (measured && batch.requests.length > 0) this.projectsWithRequests.add(project);
      if (measured) {
        const n = this.checkRun.requests.get(project) ?? 0;
        this.checkRun.requests.set(project, n + batch.requests.length);
      }
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
    }
    // Closes the run for the per-test data and the waterfall, also after an empty batch; the
    // aggregator ignores results of projects that are not measured (08-REQ-36).
    this.aggregator.endResult(meta);
  }

  /**
   * In pass k the repetition index moves by (k − 1) × repeatEach of the test's project, so the
   * results of one test in different passes have different resultIds (08-REQ-08, D-39).
   */
  private passMeta(meta: TestMeta, test: TestLike): TestMeta {
    if (this.passIndex === 1) return meta;
    const project = this.conditions.projects.find((p) => p.name === meta.project);
    const index = (this.passIndex - 1) * (project?.repeatEach ?? 1) + test.repeatEachIndex;
    return { ...meta, repeatEachIndex: index, resultId: resultId(test.id, index, meta.retry) };
  }

  /** Warnings known only at the end of the run (09, chapter 12.1). */
  private runWarnings(): Issue[] {
    const issues: Issue[] = [];
    // Projects with instrumented tests but no request sample, e.g. API tests (09-REQ-33).
    const silent = [...this.instrumentedProjects]
      .filter((p) => !this.projectsWithRequests.has(p))
      .sort();
    if (silent.length > 0) {
      issues.push({
        code: 'RUN_PROJECT_NO_REQUESTS',
        message: `Measured ${silent.length === 1 ? 'project' : 'projects'} ${silent.join(', ')} recorded no request sample.`,
        hint: 'Tests that only use the request fixture (API tests) are not measured: requests made outside the browser are out of scope; remove such projects from run.projects. Otherwise check use.baseURL, withPerfFixtures and measure.include/exclude.',
      });
    }
    if (this.notInstrumented > 0) {
      issues.push({
        code: 'TESTS_NOT_INSTRUMENTED',
        message: `${plural(this.notInstrumented, 'test result')} of measured projects ${this.notInstrumented === 1 ? 'has' : 'have'} no ${SAMPLES_ATTACHMENT_NAME} attachment, so ${this.notInstrumented === 1 ? 'it was' : 'they were'} not measured.`,
        hint: 'Import test from a test object wrapped with withPerfFixtures() (or from "playwright-performance-regression/test"); a crashed worker also loses the attachment.',
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

  /** Test counts of this pass only. */
  private ownTests(): TestCounts {
    const tests = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
    for (const test of this.testsSeen) tests[test.outcome()] += 1;
    return tests;
  }

  /** Test counts of the run: the sum over the merged passes (02-REQ-37). */
  private testsResult(status: FullResultLike['status']): RunReport['tests'] {
    const own = this.ownTests();
    const merged = this.mergedTests;
    return {
      status,
      expected: own.expected + merged.expected,
      unexpected: own.unexpected + merged.unexpected,
      flaky: own.flaky + merged.flaky,
      skipped: own.skipped + merged.skipped,
    };
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
      stepNormalization: this.steps.fingerprint(),
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
      stepNormalization: this.steps.fingerprint(),
      passes: {
        planned: this.passes,
        completed: this.completedPasses,
        failed: [...this.failedPasses],
      },
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
    return {
      width:
        out.isTTY === true && out.columns !== undefined && out.columns > 0
          ? out.columns
          : DEFAULT_WIDTH,
      color: colorEnabled(out, this.host.env),
    };
  }

  /**
   * onEnd (01, chapter 3.3, steps 8–9). Returns the status for Playwright: `failed` when the
   * outcome exit code is not 0, otherwise nothing, so Playwright keeps its own (01-REQ-17).
   */
  async end(result: FullResultLike): Promise<{ status?: FullResultLike['status'] } | undefined> {
    if (this.cancelled) return undefined;
    // Passes 2…N only write their data for the first pass (04-REQ-64).
    if (this.passIndex > 1) return this.endLaterPass(result);
    // --list, or a filter that selected no test: no report, no outcome, no status (01-REQ-40).
    if (this.testsStarted === 0) return undefined;
    if (this.check) return this.endCheck(result);
    let status = result.status;
    let outcome: Outcome;
    try {
      if (this.passes > 1) status = await this.runPasses(result);
      outcome = await this.finish({ status });
    } catch (error) {
      this.recordInternalError('onEnd', error);
      outcome = this.fallbackOutcome({ status });
      for (const issue of outcome.toolErrors) {
        this.host.stderr.write(`${PACKAGE_NAME}: ${issue.code}: ${issue.message}\n`);
      }
    }
    const written = await this.writeOutcome(outcome);
    if (this.environmentMode && written !== null) {
      this.host.stdout.write(outcomeLine(outcome, written));
    }
    // The last line of the output (09-REQ-32).
    if (this.next !== null) {
      this.host.stdout.write(nextLine(this.next, this.terminal().color));
    }
    // A failed test in a later pass fails the command like in one run (04-REQ-64).
    const testsFailed = status === 'failed' && result.status === 'passed' && this.environmentMode;
    return outcome.exitCode === 0 && !testsFailed ? undefined : { status: 'failed' };
  }

  /** Data of this pass for the first pass (02-REQ-36). */
  private passFile(status: FullResultLike['status'], finishedAt: Date): PassFile {
    return {
      format: 'pw-perf-pass',
      schemaVersion: 1,
      toolVersion: this.settings.packageVersion,
      runId: this.runId,
      pass: { index: this.passIndex, total: this.passes },
      startedAt: this.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      status,
      tests: this.ownTests(),
      counters: {
        testsStarted: this.testsStarted,
        notInstrumented: this.notInstrumented,
        withArtifacts: this.withArtifacts,
        instrumentedProjects: [...this.instrumentedProjects].sort(),
        projectsWithRequests: [...this.projectsWithRequests].sort(),
        pending: Object.fromEntries([...this.pending].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
      },
      warnings: this.warnings.slice(this.beginWarnings),
      toolErrors: this.toolErrors.slice(this.beginToolErrors),
      entries: this.aggregator.journal ?? [],
    };
  }

  private passPath(index: number): string {
    return this.host.io.resolvePath(this.reportDir(), passFileName(index));
  }

  /** onEnd of pass k > 1 (04-REQ-64): the pass file and one line, no evaluation. */
  private async endLaterPass(
    result: FullResultLike,
  ): Promise<{ status?: FullResultLike['status'] } | undefined> {
    const label = `pass ${String(this.passIndex)}/${String(this.passes)}`;
    const file = this.passFile(result.status, this.host.now());
    const path = this.passPath(this.passIndex);
    try {
      await this.host.io.writeJsonStable(path, file);
    } catch (error) {
      this.host.stderr.write(
        `${PACKAGE_NAME}: ${label}: the pass file could not be written to ${path}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return undefined;
    }
    const samples = file.entries.filter((e) => e[0] !== 'e').length;
    this.info(`${label} done: ${plural(this.testsStarted, 'test')}, ${plural(samples, 'sample')}.`);
    return undefined;
  }

  /**
   * Passes 2…N of the first pass (04-REQ-63, 04-REQ-64): writes pass-1.json, runs every further
   * pass with the same command and merges its pass file. Returns the status of the run.
   */
  private async runPasses(result: FullResultLike): Promise<FullResultLike['status']> {
    let status = result.status;
    if (status !== 'passed' && status !== 'failed') return status;
    const io = this.host.io;
    try {
      await io.writeJsonStable(this.passPath(1), this.passFile(status, this.host.now()));
    } catch {
      // The data of pass 1 stay in memory; the file is only for diagnosis.
    }
    this.aggregator.journal = null;
    const total = this.passes;
    const command = passCommand({
      execPath: this.host.execPath,
      argv: this.host.argv,
      env: this.host.env,
      scripts: io.readPackageInfo(this.host.cwd).scripts,
    });
    const shown = [command.file, ...command.args].join(' ');
    for (let index = 2; index <= total; index += 1) {
      const label = `pass ${String(index)}/${String(total)}`;
      this.info(`${label}: starting ${shown}`);
      const env = {
        ...this.host.env,
        ...writeModeState({ ...this.settings.mode, runId: this.runId, pass: { index, total } }),
      };
      const exit = await this.host.runPass(command, env);
      if (exit.error !== undefined) {
        this.toolErrors.push({
          code: 'RUN_PASS_SPAWN_FAILED',
          message: `${label} could not be started (${shown}): ${exit.error}`,
          hint: 'Check that the test command runs on its own; set run.passes to 1 to measure in one pass.',
        });
        break;
      }
      if (exit.signal !== null || exit.code === 130 || exit.code === 143) {
        const rest =
          index < total
            ? `passes ${String(index + 1)}–${String(total)} did not run`
            : 'it was the last pass';
        this.toolErrors.push({
          code: 'RUN_PASS_INTERRUPTED',
          message: `${label} was interrupted (${exit.signal ?? `exit code ${String(exit.code)}`}); ${rest}.`,
          hint: 'Run the measurement again; the evaluation of the completed passes is in the report.',
        });
        break;
      }
      const path = this.passPath(index);
      let text: string | null;
      try {
        text = await io.readTextFile(path);
      } catch {
        text = null;
      }
      const parsed =
        text === null
          ? { ok: false as const, reason: 'no pass file was written' }
          : parsePassFile(text, {
              toolVersion: this.settings.packageVersion,
              runId: this.runId,
              index,
              total,
            });
      if (!parsed.ok) {
        this.failedPasses.push(index);
        this.warnings.push({
          code: 'RUN_PASS_FAILED',
          message: `${label} produced no results (exit code ${String(exit.code)}: ${parsed.reason}), e.g. a setup step of the test script failed.`,
          hint: 'The evaluation uses the other passes; check the output of that pass above.',
        });
        continue;
      }
      this.mergePass(parsed.value);
      status = worseStatus(status, parsed.value.status);
    }
    return status;
  }

  /** Adds the data of a later pass to this run (04-REQ-64). */
  private mergePass(file: PassFile): void {
    replayEntries(this.aggregator, file.entries);
    for (const name of ['expected', 'unexpected', 'flaky', 'skipped'] as const) {
      this.mergedTests[name] += file.tests[name];
    }
    const c = file.counters;
    this.testsStarted += c.testsStarted;
    this.notInstrumented += c.notInstrumented;
    this.withArtifacts += c.withArtifacts;
    for (const p of c.instrumentedProjects) this.instrumentedProjects.add(p);
    for (const p of c.projectsWithRequests) this.projectsWithRequests.add(p);
    for (const [key, n] of Object.entries(c.pending)) {
      this.pending.set(key, (this.pending.get(key) ?? 0) + n);
    }
    this.warnings.push(...file.warnings);
    this.toolErrors.push(...file.toolErrors);
    this.completedPasses += 1;
  }

  private async finish(result: FullResultLike): Promise<Outcome> {
    const cfg = this.settings.config;
    const io = this.host.io;
    const finishedAt = this.host.now();
    const warnings = [...this.warnings, ...this.runWarnings()];
    const toolErrors = [...this.toolErrors];

    const aggregates = this.aggregator.finalize();
    warnings.push(
      ...aggregates.issues,
      ...detectKeyExplosion(Object.keys(aggregates.endpoints)),
      ...this.steps.issues(Object.keys(aggregates.steps)),
    );
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
      steps: cfg.measure.steps.enabled,
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

    const writeJson = async (): Promise<boolean> => {
      try {
        const path = io.resolvePath(reportDir, 'report.json');
        await io.writeJsonStable(path, report);
        paths.reportJson = path;
        return true;
      } catch (error) {
        toolErrors.push({
          code: 'REPORT_WRITE_FAILED',
          message: `The run report could not be written to ${reportDir}: ${error instanceof Error ? error.message : String(error)}`,
          hint: 'Check that report.dir is writable.',
        });
        report = build();
        return false;
      }
    };
    await writeJson();
    if (cfg.report.html) {
      const issue = await this.writeHtml(report, io.resolvePath(reportDir, 'report.html'), paths);
      if (issue !== null) {
        // The JSON report stays and records the HTML error (11, chapter 12; exit code 3).
        toolErrors.push(issue);
        report = build();
        if (paths.reportJson !== null) await writeJson();
      }
    }

    const { width, color } = this.terminal();
    this.host.stdout.write(
      formatSummary(report, {
        width,
        color,
        ascii: asciiTerminal(this.host.env),
        html: paths.reportHtml !== null,
      }),
    );
    const noSteps = this.steps.noStepsLine(Object.keys(aggregates.steps));
    if (noSteps !== null) this.host.stdout.write(noSteps);
    if (diffs.length > 0) {
      this.host.stdout.write(
        formatThresholdsDiff(diffs, {
          paths: diffPaths.map((p) => io.relativeSlashPath(this.host.cwd, p)),
          width,
          color,
          prune: this.pruned,
          // Absolute, like the Report line of the summary (10, chapter 9.1; 09-REQ-30).
          diffPath: paths.thresholdsDiff,
        }),
      );
    }
    this.next = nextHint({ report, commands: this.commands(), written: this.written });
    return buildOutcome(report, paths);
  }

  private countCheck(test: TestLike, result: ResultLike, measured: boolean): void {
    const c = this.checkRun;
    const duration = result.duration ?? 0;
    if (!measured) {
      c.setupMs += duration;
      return;
    }
    if (result.status === 'skipped') {
      c.skipped += 1;
      return;
    }
    c.ran += 1;
    if (result.status === 'passed' || result.status === test.expectedStatus) c.passed += 1;
    else c.failed += 1;
    c.durations.push(duration);
    const project = projectName(test);
    c.tests.set(project, (c.tests.get(project) ?? 0) + 1);
  }

  /** onEnd of a check (04-REQ-50, 04-REQ-53): output, no report, no files; outcome only via the CLI. */
  private async endCheck(
    result: FullResultLike,
  ): Promise<{ status?: FullResultLike['status'] } | undefined> {
    let outcome: Outcome;
    try {
      outcome = await this.finishCheck(result);
    } catch (error) {
      this.recordInternalError('onEnd', error);
      outcome = {
        ...this.fallbackOutcome(result),
        mode: 'check',
        evaluation: { status: 'error', gateEnabled: false },
      };
    }
    if (!this.environmentMode) await this.writeOutcome(outcome);
    // The state file of the test selection (04-REQ-49); the CLI removes it too.
    if (this.settings.mode.runId !== undefined) {
      try {
        this.host.io.removeFileSync(
          this.host.io.tempPath(checkStateFileName(this.settings.mode.runId)),
        );
      } catch {
        // A left-over file in the temporary directory is harmless.
      }
    }
    if (this.next !== null) this.host.stdout.write(nextLine(this.next, this.terminal().color));
    return outcome.exitCode === 0 ? undefined : { status: 'failed' };
  }

  private async finishCheck(result: FullResultLike): Promise<Outcome> {
    const cfg = this.settings.config;
    const config = this.configLike;
    const c = this.checkRun;
    const aggregates = this.aggregator.finalize();
    const tests = this.testsResult(result.status);
    // With ten tests one failure is 10%: a check never has TESTS_FAILED_TOO_MANY (04-REQ-53).
    const assessment = assessRun(
      { tests, maxFailures: this.maxFailures, sharded: false },
      { maxFailedTestShare: 1 },
    );
    const toolErrors = [...this.toolErrors, ...assessment.toolErrors];
    const baseUrls = this.conditions.projects.map((p, i) => ({
      project: p,
      baseURL: config?.projects[i]?.use.baseURL ?? null,
    }));
    const warnings: Issue[] = [
      ...this.warnings,
      ...this.runWarnings(),
      ...assessment.warnings,
      ...aggregates.issues,
      ...detectKeyExplosion(Object.keys(aggregates.endpoints)),
      ...this.steps.issues(Object.keys(aggregates.steps)),
    ];
    // An unset baseURL is reported only by a check (03-REQ-21).
    const unset = baseUrls
      .filter(
        (b) => b.project.role === 'measured' && (b.baseURL === null || b.baseURL === undefined),
      )
      .map((b) => b.project.name);
    if (unset.length > 0) {
      warnings.push({
        code: 'CONFIG_BASEURL_EMPTY',
        message: `Measured ${unset.length === 1 ? 'project' : 'projects'} ${unset.join(', ')} ${unset.length === 1 ? 'has' : 'have'} no use.baseURL.`,
        hint: 'If baseURL comes from environment variables, run the tests through the script that sets them (e.g. PW_PERF_MODE=check npm run e2e:qa, see docs/dynamic-environments.md).',
      });
    }
    const keys = cfg.keys;
    const baseOrigins = baseUrls.flatMap((b) =>
      b.project.role === 'measured' && typeof b.baseURL === 'string' ? [b.baseURL] : [],
    );
    const candidates = [
      ...aggregates.origins.map((o) => o.origin),
      ...baseOrigins.flatMap((u) => {
        try {
          return [new URL(u).origin];
        } catch {
          return [];
        }
      }),
    ];
    const baseSet = new Set(
      baseOrigins.flatMap((u) => (URL.canParse(u) ? [new URL(u).origin] : [])),
    );
    const random = randomHostIssue(
      [...new Set(candidates)]
        .filter((o) => !coveredByOrigins(keys.origins, o))
        .map((origin) => ({ origin, base: baseSet.has(origin) })),
    );
    if (random !== null) warnings.push(random);

    const patterns = compileHostPatterns(keys.origins);
    const exact = new Set(
      Object.keys(keys.origins)
        .filter((k) => !isHostPattern(k))
        .flatMap((k) => (URL.canParse(k) ? [new URL(k).origin] : [])),
    );
    const origins = [...aggregates.origins]
      .sort((a, b) => b.requestCount - a.requestCount || (a.origin < b.origin ? -1 : 1))
      .map((o) => {
        const pattern = URL.canParse(o.origin)
          ? matchingPattern(patterns, new URL(o.origin))
          : null;
        const source = exact.has(o.origin)
          ? 'keys.origins'
          : pattern !== null
            ? `keys.origins pattern ${pattern.canonical}`
            : baseSet.has(o.origin)
              ? 'baseURL'
              : 'host';
        return { origin: o.origin, label: o.label, requests: o.requestCount, source };
      });
    const topKeys = [
      ...Object.entries(aggregates.endpoints).map(([key, a]) => ({
        kind: 'api' as const,
        key,
        samples: a.count,
        tests: a.testCount,
      })),
      ...Object.entries(aggregates.steps).map(([key, a]) => ({
        kind: 'step' as const,
        key,
        samples: a.count,
        tests: a.testCount,
      })),
    ]
      .sort(
        (a, b) =>
          b.samples - a.samples ||
          (a.kind === b.kind ? 0 : a.kind === 'api' ? -1 : 1) ||
          (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
      )
      .slice(0, 10);

    const location = {
      configDir: this.configDir,
      dir: cfg.thresholds.dir,
      filePrefix: cfg.thresholds.filePrefix,
      env: cfg.run.env,
      steps: cfg.measure.steps.enabled,
    };
    const loaded = await this.host.io.loadThresholds(location);
    const kindsWithKeys = {
      api: Object.keys(aggregates.endpoints).length > 0,
      step: Object.keys(aggregates.steps).length > 0,
    };
    const thresholdsFiles = (['api', 'step'] as const)
      .filter((kind) => kind === 'api' || kindsWithKeys.step || !cfg.measure.steps.enabled)
      .map((kind) => {
        const file = loaded[kind];
        if (kind === 'step' && !cfg.measure.steps.enabled)
          return { kind, name: file.path, state: 'not used' };
        const state =
          file.status === 'loaded'
            ? `${String(Object.keys(file.file.entries).length)} entries`
            : file.status === 'missing'
              ? 'missing'
              : `invalid (${file.issues[0]?.code ?? 'SCHEMA_VALIDATION_FAILED'})`;
        return { kind, name: file.path, state };
      });
    const missingFile = (['api', 'step'] as const).some(
      (kind) => kindsWithKeys[kind] && loaded[kind].status !== 'loaded',
    );

    const meanMs =
      c.durations.length === 0 ? null : c.durations.reduce((a, b) => a + b, 0) / c.durations.length;
    // The package reporter by its short name, not by the path the CLI or withPerf() adds.
    const reporters = (config?.reporter ?? []).map(([name]) =>
      /playwright-performance-regression|[\\/]dist[\\/]reporter\.c?js$/u.test(name)
        ? 'pw-perf'
        : name,
    );
    const { width, color } = this.terminal();
    this.host.stdout.write(
      formatCheckSummary(
        {
          packageName: 'pw-perf',
          ran: c.ran,
          selected: c.selected,
          passed: c.passed,
          failed: c.failed,
          skippedByCheck: c.skipped,
          projects: this.conditions.projects.map((p, i) => ({
            name: p.name,
            role: p.role,
            browserName: p.browserName,
            baseURL: config?.projects[i]?.use.baseURL ?? null,
            requests: c.requests.get(p.name) ?? 0,
            tests: c.tests.get(p.name) ?? 0,
          })),
          removedProjects: this.settings.runConditions.removedProjects,
          reporters: {
            kept: reporters,
            replaced: this.settings.runConditions.replacedReporters,
            removed: this.settings.runConditions.removedReporters,
          },
          requests: aggregates.origins.reduce((n, o) => n + o.requestCount, 0),
          apiKeys: Object.keys(aggregates.endpoints).length,
          stepKeys: Object.keys(aggregates.steps).length,
          origins,
          topKeys,
          thresholdsFiles,
          warnings: collapseIssues(warnings),
          toolErrors: collapseIssues(toolErrors),
          estimate: estimateText({
            tests: c.selected,
            passesTest: this.settings.mode.passes ?? cfg.run.passes.test,
            passesThresholds: cfg.run.passes.thresholds,
            meanMs,
            setupMs: c.setupMs,
          }),
        },
        { width, color, ascii: asciiTerminal(this.host.env) },
      ),
    );
    const commands = this.commands();
    this.next =
      toolErrors.length > 0
        ? null
        : !kindsWithKeys.api && !kindsWithKeys.step
          ? `nothing was measured: check use.baseURL and run.projects, then run ${commands.check}`
          : missingFile
            ? `derive thresholds on the CI machines: ${commands.thresholds}`
            : `run the measurement: ${commands.test}`;
    return {
      schemaVersion: SCHEMA_VERSIONS.outcome,
      runId: this.runId,
      mode: 'check',
      exitCode: toolErrors.length > 0 ? 3 : 0,
      tests: { status: result.status },
      evaluation: { status: toolErrors.length > 0 ? 'error' : 'passed', gateEnabled: false },
      toolErrors: collapseIssues(toolErrors),
      paths: { reportJson: null, reportHtml: null, thresholds: [], thresholdsDiff: null },
    };
  }

  /** Commands of the project for each mode, for the Next: hint (09-REQ-32). */
  private commands(): Record<PerfMode, string> {
    const env = this.host.env;
    const info = this.host.io.readPackageInfo(this.configDir);
    const ctx: CommandContext = {
      viaCli: !this.environmentMode,
      env: this.settings.config.run.env,
      lifecycleEvent: env['npm_lifecycle_event'] ?? null,
      lifecycleScript: env['npm_lifecycle_script'] ?? null,
      userAgent: env['npm_config_user_agent'] ?? null,
      lockFiles: info.lockFiles,
      scripts: info.scripts,
      platform: this.host.host.platform,
    };
    return {
      test: suggestCommand('test', ctx),
      thresholds: suggestCommand('thresholds', ctx),
      check: suggestCommand('check', ctx),
    };
  }

  /**
   * Writes report.html next to report.json (11-REQ-04). The page is rendered from the report as
   * written to JSON, so `report` renders the same HTML from report.json (11-AC-10). Returns the
   * HTML_RENDER_FAILED or HTML_WRITE_FAILED tool error (11, chapter 13), or null.
   */
  private async writeHtml(
    report: RunReport,
    path: string,
    paths: Outcome['paths'],
  ): Promise<Issue | null> {
    const render = this.options.renderHtml ?? renderHtmlReport;
    let page: string;
    try {
      page = render(JSON.parse(stringifyStable(report)) as RunReport);
    } catch (error) {
      return {
        code: 'HTML_RENDER_FAILED',
        message: `The HTML report could not be rendered: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        hint: 'This is a bug in the package; please report it with the message above. report.json is complete.',
      };
    }
    try {
      await this.host.io.writeTextAtomic(path, page);
      paths.reportHtml = path;
      return null;
    } catch (error) {
      return {
        code: 'HTML_WRITE_FAILED',
        message: `The HTML report could not be written to ${path}: ${error instanceof Error ? error.message : String(error)}`,
        hint: `Check that report.dir is writable; \`${CLI_COMMAND} report\` renders it again from report.json.`,
      };
    }
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
      prune: this.prune(warnings),
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
        this.written.push({
          name: loaded[file.kind].path,
          entries: Object.keys(file.content.entries).length,
        });
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

  /** Thresholds files written in this run, for the Next: hint (09-REQ-32). */
  private readonly written: WrittenFile[] = [];
  /** Text of the Next: hint, set by finish(). */
  private next: string | null = null;

  /** Whether entries not seen were removed in this run (04-REQ-35). */
  private pruned = false;

  /**
   * PW_PERF_PRUNE in the environment mode with a test filter in the arguments: the files are
   * written without removing entries, with RUN_PRUNE_SKIPPED (04-REQ-35). The CLI rejects the
   * same case before the run.
   */
  private prune(warnings: Issue[]): boolean {
    if (this.settings.mode.prune !== true) return false;
    const filters = this.environmentMode ? testFilters(testArgsFromArgv(this.host.argv)) : [];
    if (filters.length > 0) {
      warnings.push({
        code: 'RUN_PRUNE_SKIPPED',
        message: `PW_PERF_PRUNE was ignored: the run selects a subset of the tests (${filters.join(' ')}), so entries not seen were kept.`,
        hint: 'Prune in a run of all tests, without --grep, --project or file filters.',
      });
      return false;
    }
    this.pruned = true;
    return true;
  }

  /** Run without the CLI: the CLI sets PW_PERF_OUTCOME_FILE (04-REQ-62, D-35). */
  private get environmentMode(): boolean {
    return this.settings.mode.outcomeFile === undefined;
  }

  /** PW_PERF_OUTCOME_FILE, else <report.dir>/outcome.json (02-REQ-27, 04-REQ-62). */
  private outcomePath(): string | null {
    const file = this.settings.mode.outcomeFile;
    if (file !== undefined) return file;
    const io = this.host.io;
    return io.resolvePath(
      io.resolvePath(this.configDir, this.settings.config.report.dir),
      'outcome.json',
    );
  }

  /** Last step of onEnd (02-REQ-27); returns the path written, or null. */
  private async writeOutcome(outcome: Outcome): Promise<string | null> {
    const file = this.outcomePath();
    if (file === null) return null;
    try {
      await this.host.io.writeJsonStable(file, outcome);
      return file;
    } catch (error) {
      this.host.stderr.write(
        `${PACKAGE_NAME}: OUTCOME_WRITE_FAILED: the outcome file could not be written to ${file}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return null;
    }
  }
}

/**
 * CONFIG_BASEURL_EMPTY (03-REQ-21): a measured project whose use.baseURL is blank or has a host
 * label "undefined" or "null", the result of joining an unset variable. An unset baseURL is not
 * reported here (only by check, 04-REQ-50).
 */
function emptyBaseUrlWarning(
  conditions: RunReport['runConditions'],
  config: ConfigLike,
): Issue | null {
  const names = conditions.projects.flatMap((p, i) => {
    if (p.role !== 'measured') return [];
    const baseURL = config.projects[i]?.use.baseURL;
    if (typeof baseURL !== 'string') return [];
    if (baseURL.trim() === '') return [p.name];
    let host: string;
    try {
      host = new URL(baseURL).hostname;
    } catch {
      return [];
    }
    return host.split('.').some((label) => label === 'undefined' || label === 'null')
      ? [p.name]
      : [];
  });
  if (names.length === 0) return null;
  return {
    code: 'CONFIG_BASEURL_EMPTY',
    message: `Measured ${names.length === 1 ? 'project' : 'projects'} ${names.join(', ')} ${names.length === 1 ? 'has' : 'have'} an empty use.baseURL.`,
    hint: 'If baseURL comes from environment variables, run the tests through the script that sets them (e.g. PW_PERF_MODE=test npm run e2e:qa, see docs/dynamic-environments.md).',
  };
}
