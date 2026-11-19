// CLI entry logic (01, chapter 4.10; 04): parses the arguments and runs the command. Every error
// is caught at this boundary and ends with exit code 3 (01, chapter 8).
import type { Issue } from '../core/types/index.ts';
import { renderHtmlReport } from '../html/index.ts';
import { helpText } from './help.ts';
import { runInit } from './init/index.ts';
import type { CliHost } from './host.ts';
import { renderReport, thresholdsFrom } from './offline.ts';
import type { HtmlRenderer } from './offline.ts';
import { formatIssues } from './output.ts';
import { parseArgs } from './parse.ts';
import { runTests } from './run.ts';

export interface MainOptions {
  /** HTML renderer for the report command; renderHtmlReport by default (11). */
  renderHtml?: HtmlRenderer;
}

function color(host: CliHost): { color: boolean } {
  return { color: host.stderr.isTTY === true && (host.env.NO_COLOR ?? '') === '' };
}

function internalError(error: unknown): Issue {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return {
    code: 'CLI_INTERNAL_ERROR',
    message: `Unexpected error in the CLI: ${text}`,
    hint: 'This is a bug in the package; please report it with the message above.',
  };
}

/** Runs the CLI with `argv` (the arguments after the command name) and returns the exit code. */
export async function main(
  argv: readonly string[],
  host: CliHost,
  options: MainOptions = {},
): Promise<number> {
  try {
    const parsed = parseArgs(argv);
    if (!parsed.ok) {
      host.stderr.write(formatIssues(parsed.issues, 'error', color(host)));
      return 3;
    }
    const cmd = parsed.value;
    switch (cmd.kind) {
      case 'help':
        host.stdout.write(helpText(cmd.command));
        return 0;
      case 'version':
        host.stdout.write(`${host.packageVersion}\n`);
        return 0;
      case 'run':
        return await runTests(cmd, host);
      case 'thresholds-from':
        return await thresholdsFrom(cmd, host);
      case 'report':
        return await renderReport(cmd, host, options.renderHtml ?? renderHtmlReport);
      case 'init':
        return await runInit(cmd, host, color(host));
    }
  } catch (error) {
    host.stderr.write(formatIssues([internalError(error)], 'error', color(host)));
    return 3;
  }
}
