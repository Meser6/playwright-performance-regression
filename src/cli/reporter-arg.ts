// The package reporter with an explicit --reporter flag (04-REQ-15, V-05). Pure.
import type { CliIssue, Result } from '../core/types/index.ts';
import { scanPlaywrightArgs } from './playwright-args.ts';

/**
 * Appends the package reporter to the value of the LAST --reporter flag: Playwright uses only the
 * last one, and the flag replaces the reporters of the config, including the one withPerf()
 * adds. Without --reporter the arguments are returned unchanged. Playwright splits the value at
 * commas, so a reporter path with a comma cannot be passed (CLI_REPORTER_PATH_UNSUPPORTED).
 */
export function withPerfReporterArg(
  args: readonly string[],
  reporterPath: string,
): Result<string[], CliIssue> {
  const reporters = scanPlaywrightArgs(args).options.filter(
    (o) => o.name === '--reporter' && o.values.length > 0,
  );
  const last = reporters[reporters.length - 1];
  if (last === undefined) return { ok: true, value: [...args] };
  if (reporterPath.includes(',')) {
    return {
      ok: false,
      issues: [
        {
          code: 'CLI_REPORTER_PATH_UNSUPPORTED',
          message: `The package reporter cannot be added to --reporter: its path contains a comma, and Playwright splits the --reporter value at commas (${reporterPath}).`,
          hint: 'Remove --reporter from the arguments (withPerf() then adds the reporter itself), or move the project to a path without a comma.',
        },
      ],
    };
  }
  const value = `${last.values[0] as string},${reporterPath}`;
  const result = [...args];
  if (last.inline) result[last.index] = `--reporter=${value}`;
  else result[last.index + 1] = value;
  return { ok: true, value: result };
}
