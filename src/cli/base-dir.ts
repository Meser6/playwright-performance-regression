// Base directory of relative paths (thresholds.dir, report.dir) in the commands without tests
// (04-REQ-26, 04-D-07). Pure: the caller passes the existence check and the directory helper.
import type { CliIssue } from '../core/types/index.ts';

export interface BaseDirInput {
  /** Absolute path of the loaded package config file (source 1 or 2 of 01, chapter 7.3). */
  loadedConfigFile?: string;
  /** configDir of the run report. */
  reportConfigDir?: string;
  cwd: string;
  exists: (dir: string) => boolean;
  /** Directory part of a path; default: everything before the last "/" or "\". */
  dirname?: (path: string) => string;
}

function parentOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut <= 0 ? path.slice(0, cut + 1) || '.' : path.slice(0, cut);
}

/** Config file directory, else configDir of the report if it exists here, else cwd with a warning. */
export function resolveBaseDir(input: BaseDirInput): { dir: string; issues: CliIssue[] } {
  if (input.loadedConfigFile !== undefined) {
    return { dir: (input.dirname ?? parentOf)(input.loadedConfigFile), issues: [] };
  }
  if (input.reportConfigDir !== undefined && input.exists(input.reportConfigDir)) {
    return { dir: input.reportConfigDir, issues: [] };
  }
  return {
    dir: input.cwd,
    issues: [
      {
        code: 'CLI_CONFIG_DIR_MISSING',
        message:
          input.reportConfigDir === undefined
            ? `No package config file was loaded; relative paths (thresholds.dir, report.dir) are resolved against the current directory ${input.cwd}.`
            : `The config directory of the report (${input.reportConfigDir}) does not exist on this machine; relative paths (thresholds.dir, report.dir) are resolved against the current directory ${input.cwd}.`,
        hint: 'Run the command from the directory of playwright.config.',
      },
    ],
  };
}
