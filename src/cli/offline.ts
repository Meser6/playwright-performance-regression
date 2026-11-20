// Commands without tests (04, chapter 4.6): `thresholds --from <report.json>` derives the
// thresholds files with the same core functions as the reporter (01-REQ-01, 04-REQ-27), and
// `report` renders the HTML report again (04-REQ-28).
import { DEFAULT_CONFIG } from '../core/config/index.ts';
import { parseRunReport, schemaIssueToIssue } from '../core/schema/index.ts';
import {
  deriveThresholds,
  diffThresholds,
  formatThresholdsDiffMarkdown,
} from '../core/thresholds/index.ts';
import { CLI_COMMAND } from '../core/types/index.ts';
import type { Issue, RunReport } from '../core/types/index.ts';
import { formatThresholdsDiff } from '../console/thresholds-diff.ts';
import {
  loadThresholds,
  readTextFile,
  relativeSlashPath,
  resolvePath,
  thresholdsFilePaths,
  writeJsonStable,
  writeTextAtomic,
} from '../io/index.ts';
import { resolveBaseDir } from './base-dir.ts';
import { configSourceLine, resolveCliConfig } from './config-file.ts';
import type { CliConfig } from './config-file.ts';
import type { CliHost } from './host.ts';
import { formatIssues, infoLine, outputStyle } from './output.ts';
import type { ParsedCommand } from './parse.ts';

export type FromCommand = Extract<ParsedCommand, { kind: 'thresholds-from' }>;
export type ReportCommand = Extract<ParsedCommand, { kind: 'report' }>;

/** Terminal width without a terminal (09-REQ-22). */
const DEFAULT_WIDTH = 120;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class Printer {
  private readonly host: CliHost;

  constructor(host: CliHost) {
    this.host = host;
  }

  get color(): boolean {
    return outputStyle(this.host.stderr, this.host.env).color;
  }

  errors(issues: readonly Issue[]): number {
    this.host.stderr.write(formatIssues(issues, 'error', this));
    return 3;
  }

  warnings(issues: readonly Issue[]): void {
    this.host.stderr.write(formatIssues(issues, 'warning', this));
  }

  info(line: string): void {
    this.host.stderr.write(infoLine(line));
  }
}

function reportNotFound(path: string, how: string): Issue {
  return {
    code: 'CLI_REPORT_NOT_FOUND',
    message: `The run report ${path} does not exist (${how}).`,
    hint: `Pass the report explicitly, e.g. --input apps/web/${DEFAULT_CONFIG.report.dir}/report.json, or run "${CLI_COMMAND} test" first.`,
  };
}

/** Reads and validates a run report; null text means the file is missing. */
async function readReport(
  path: string,
): Promise<{ ok: true; report: RunReport } | { ok: false; issues: Issue[]; missing: boolean }> {
  let text: string | null;
  try {
    text = await readTextFile(path);
  } catch (error) {
    return {
      ok: false,
      missing: false,
      issues: [
        {
          code: 'SCHEMA_INVALID_JSON',
          message: `${path}: the file cannot be read (${message(error)})`,
          hint: 'Check the path and the file permissions.',
        },
      ],
    };
  }
  if (text === null) return { ok: false, missing: true, issues: [] };
  const parsed = parseRunReport(text, path);
  if (!parsed.ok)
    return { ok: false, missing: false, issues: parsed.issues.map(schemaIssueToIssue) };
  return { ok: true, report: parsed.value };
}

/** Config and base directory for a command without tests (04-REQ-25, 04-REQ-26). */
async function configFor(
  host: CliHost,
  out: Printer,
  options: {
    explicit?: string;
    report?: RunReport;
    env?: string | null;
    mode: 'test' | 'thresholds';
  },
): Promise<{ cfg: CliConfig; baseDir: string } | null> {
  const reportDir = options.report?.configDir;
  const reportDirExists = reportDir !== undefined && (await host.exists(reportDir));
  const searchDirs = [host.cwd];
  if (reportDirExists && reportDir !== host.cwd) searchDirs.push(reportDir);
  const resolved = await resolveCliConfig(
    {
      ...(options.explicit === undefined
        ? {}
        : { explicit: host.paths.resolve(host.cwd, options.explicit) }),
      searchDirs,
      ...(options.report === undefined ? {} : { report: options.report }),
      mode: options.mode,
      ...(options.env === undefined ? {} : { env: options.env }),
    },
    { exists: (p) => host.exists(p), importModule: (url) => host.importModule(url) },
  );
  if (!resolved.ok) {
    out.errors(resolved.issues);
    return null;
  }
  const cfg = resolved.value;
  for (const note of cfg.notes) out.info(note);
  out.info(configSourceLine(cfg.source));
  out.warnings(cfg.warnings);
  const base = resolveBaseDir({
    ...(cfg.source.kind === 'file' ? { loadedConfigFile: cfg.source.path } : {}),
    ...(reportDir === undefined ? {} : { reportConfigDir: reportDir }),
    cwd: host.cwd,
    exists: (dir) => dir === reportDir && reportDirExists,
    dirname: host.paths.dirname,
  });
  out.warnings(base.issues);
  out.info(`base directory: ${base.dir}`);
  return { cfg, baseDir: base.dir };
}

/** `thresholds --from <report.json>` (04-REQ-27): 0 on success, 3 on any error (04-REQ-24). */
export async function thresholdsFrom(cmd: FromCommand, host: CliHost): Promise<number> {
  const out = new Printer(host);
  const reportPath = host.paths.resolve(host.cwd, cmd.from);
  const read = await readReport(reportPath);
  if (!read.ok) {
    return out.errors(
      read.missing ? [reportNotFound(reportPath, 'given with --from')] : read.issues,
    );
  }
  const report = read.report;
  const resolved = await configFor(host, out, {
    ...(cmd.config === undefined ? {} : { explicit: cmd.config }),
    report,
    env: cmd.env ?? report.env,
    mode: 'thresholds',
  });
  if (resolved === null) return 3;
  const { cfg, baseDir } = resolved;
  const config = cfg.config;

  if (report.tests.status !== 'passed') {
    out.warnings([
      {
        code: 'CLI_REPORT_TESTS_FAILED',
        message: `The tests of the source run did not pass (status "${report.tests.status}"); the thresholds are derived anyway.`,
        hint: 'Review the diff before committing the thresholds files.',
      },
    ]);
  }

  const location = {
    configDir: baseDir,
    dir: config.thresholds.dir,
    filePrefix: config.thresholds.filePrefix,
    env: config.run.env,
    steps: config.measure.steps.enabled,
  };
  const loaded = await loadThresholds(location);
  const derived = deriveThresholds(report, config, loaded, {
    env: config.run.env,
    prune: cmd.prune,
    toolVersion: host.packageVersion,
  });
  if (!derived.ok) return out.errors(derived.issues);
  out.warnings(derived.value.warnings);

  const absolute = thresholdsFilePaths(location);
  const writeErrors: Issue[] = [];
  const written: string[] = [];
  for (const file of derived.value.files) {
    if (file.content === null || !file.changed) continue;
    try {
      await writeJsonStable(absolute[file.kind], file.content);
      written.push(absolute[file.kind]);
    } catch (error) {
      writeErrors.push({
        code: 'CLI_WRITE_FAILED',
        message: `The thresholds file ${absolute[file.kind]} could not be written: ${message(error)}`,
        hint: 'Check that thresholds.dir is writable, then run the command again.',
      });
    }
  }

  const diffs = derived.value.files.map((file) =>
    diffThresholds(loaded[file.kind], file, report, config),
  );
  const diffPath = resolvePath(resolvePath(baseDir, config.report.dir), 'thresholds-diff.md');
  let diffWritten = false;
  try {
    await writeTextAtomic(
      diffPath,
      formatThresholdsDiffMarkdown(
        diffs,
        derived.value.files.map((file) => loaded[file.kind].path),
      ),
    );
    diffWritten = true;
  } catch (error) {
    out.warnings([
      {
        code: 'THRESHOLDS_DIFF_WRITE_FAILED',
        message: `The thresholds diff could not be written to ${diffPath}: ${message(error)}`,
        hint: 'The thresholds files are written; check that report.dir is writable.',
      },
    ]);
  }

  const stdout = host.stdout;
  const width =
    stdout.isTTY === true && stdout.columns !== undefined && stdout.columns > 0
      ? stdout.columns
      : DEFAULT_WIDTH;
  stdout.write(
    formatThresholdsDiff(diffs, {
      paths: derived.value.files.map((file) => relativeSlashPath(host.cwd, absolute[file.kind])),
      width,
      color: outputStyle(stdout, host.env).color,
      prune: cmd.prune,
      diffPath: diffWritten ? diffPath : null,
    }),
  );
  if (writeErrors.length > 0) return out.errors(writeErrors);
  out.info(
    written.length === 0
      ? 'thresholds files unchanged · exit code 0'
      : `${written.length === 1 ? '1 thresholds file' : `${written.length} thresholds files`} written · exit code 0`,
  );
  return 0;
}

/** Renders report.html from a run report (11); provided by the HTML module. */
export type HtmlRenderer = (report: RunReport) => string;

/**
 * `report` (04-REQ-28): input from --input or `<report.dir>/report.json` of the base directory,
 * output from --output or report.html next to the input; written also with report.html false.
 * A failing renderer gives HTML_RENDER_FAILED (11, chapter 13), a failing write CLI_WRITE_FAILED.
 */
export async function renderReport(
  cmd: ReportCommand,
  host: CliHost,
  renderHtml: HtmlRenderer,
): Promise<number> {
  const out = new Printer(host);
  let report: RunReport;
  let inputPath: string;
  if (cmd.input !== undefined) {
    inputPath = host.paths.resolve(host.cwd, cmd.input);
    const read = await readReport(inputPath);
    if (!read.ok)
      return out.errors(
        read.missing ? [reportNotFound(inputPath, 'given with --input')] : read.issues,
      );
    report = read.report;
    if (
      (await configFor(host, out, {
        ...(cmd.config === undefined ? {} : { explicit: cmd.config }),
        report,
        mode: report.mode,
      })) === null
    ) {
      return 3;
    }
  } else {
    const resolved = await configFor(host, out, {
      ...(cmd.config === undefined ? {} : { explicit: cmd.config }),
      mode: 'test',
    });
    if (resolved === null) return 3;
    inputPath = resolvePath(
      resolvePath(resolved.baseDir, resolved.cfg.config.report.dir),
      'report.json',
    );
    const read = await readReport(inputPath);
    if (!read.ok)
      return out.errors(
        read.missing ? [reportNotFound(inputPath, 'report.dir of the config')] : read.issues,
      );
    report = read.report;
  }
  const outputPath =
    cmd.output === undefined
      ? resolvePath(host.paths.dirname(inputPath), 'report.html')
      : host.paths.resolve(host.cwd, cmd.output);
  let page: string;
  try {
    page = renderHtml(report);
  } catch (error) {
    return out.errors([
      {
        code: 'HTML_RENDER_FAILED',
        message: `The HTML report could not be rendered from ${inputPath}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        hint: 'This is a bug in the package; please report it with the message above.',
      },
    ]);
  }
  try {
    await writeTextAtomic(outputPath, page);
  } catch (error) {
    return out.errors([
      {
        code: 'CLI_WRITE_FAILED',
        message: `The HTML report could not be written to ${outputPath}: ${message(error)}`,
        hint: 'Check that the directory is writable, or pass another --output.',
      },
    ]);
  }
  out.info(`report: ${outputPath}`);
  return 0;
}
