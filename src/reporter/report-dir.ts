// Emptying report.dir at the start of a run (04-REQ-71) and the guard that keeps it away from
// the project, the home directory, the filesystem root and the thresholds files. Free of Node
// imports: paths and files come from the ReporterIo.
import { DEFAULT_CONFIG } from '../core/config/index.ts';
import type { Issue } from '../core/types/index.ts';
import type { ReporterIo } from './types.ts';

/** A results folder has a few entries; more means report.dir points somewhere else. */
export const MAX_REPORT_DIR_ENTRIES = 10_000;

export interface ReportDirGuardInput {
  /** report.dir as an absolute path. */
  reportDir: string;
  /** Directories report.dir must neither be nor contain, with their names for the message. */
  protectedDirs: readonly { path: string; name: string }[];
  /** thresholds.filePrefix: files <prefix>.json and <prefix>.<…>.json are thresholds files. */
  thresholdsPrefix: string;
}

/** Paths compare without case: a false refusal is harmless, a missed match is not. */
function comparable(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase();
}

/** Whether `path` is `dir` or lies inside it. */
function isWithin(dir: string, path: string): boolean {
  const d = comparable(dir);
  const p = comparable(path);
  return p === d || p.startsWith(`${d}/`) || (d === '' && p.startsWith('/'));
}

function isThresholdsFile(name: string, prefix: string): boolean {
  const lower = name.toLowerCase();
  const p = prefix.toLowerCase();
  return lower.endsWith('.json') && (lower === `${p}.json` || lower.startsWith(`${p}.`));
}

/** Entries that only a project, never a results folder, has. */
function isProjectMarker(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === 'package.json' || lower === '.git' || lower.startsWith('playwright.config.');
}

/**
 * Why report.dir must not be emptied, or null when it may be (04-REQ-71). The reason completes
 * "it …" in the warning.
 */
export function reportDirRefusal(io: ReporterIo, input: ReportDirGuardInput): string | null {
  const real = io.realPathSync(input.reportDir);
  const dirs = [input.reportDir, real];
  if (dirs.some((dir) => io.resolvePath(dir, '..') === dir)) return 'is the filesystem root';
  for (const { path, name } of input.protectedDirs) {
    const targets = [path, io.realPathSync(path)];
    if (dirs.some((dir) => targets.some((target) => isWithin(dir, target)))) {
      return `is the ${name} or contains it`;
    }
  }
  const entries = io.scanDirSync(real, MAX_REPORT_DIR_ENTRIES);
  if (entries === null) {
    return `has more than ${String(MAX_REPORT_DIR_ENTRIES)} entries`;
  }
  for (const entry of entries) {
    const name = entry.slice(entry.lastIndexOf('/') + 1);
    if (isThresholdsFile(name, input.thresholdsPrefix))
      return `contains a thresholds file (${entry})`;
    if (isProjectMarker(name)) return `contains ${entry}, so it looks like a project folder`;
  }
  return null;
}

/**
 * Empties report.dir (04-REQ-71). Returns the RUN_REPORT_DIR_NOT_CLEANED warning when the guard
 * refuses or a removal fails, otherwise null; a missing folder is left alone.
 */
export function cleanReportDir(
  io: ReporterIo,
  input: ReportDirGuardInput & { shownPath: string },
): Issue | null {
  if (!io.isDirectorySync(input.reportDir)) return null;
  const warning = (reason: string, hint: string): Issue => ({
    code: 'RUN_REPORT_DIR_NOT_CLEANED',
    message: `report.dir ${input.shownPath} was not emptied at the start of the run: ${reason}.`,
    hint,
  });
  const refusal = reportDirRefusal(io, input);
  if (refusal !== null) {
    return warning(
      `it ${refusal}`,
      `Set report.dir to a folder used only for the results of this package (default ${DEFAULT_CONFIG.report.dir}); files of earlier runs in it were kept.`,
    );
  }
  try {
    io.emptyDirSync(io.realPathSync(input.reportDir));
  } catch (error) {
    return warning(
      `removing a file failed (${error instanceof Error ? error.message : String(error)})`,
      'Check that report.dir is writable; files of earlier runs may remain next to the new ones.',
    );
  }
  return null;
}
