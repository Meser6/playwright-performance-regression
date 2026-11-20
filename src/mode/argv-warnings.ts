// Warnings from the arguments of the main Playwright process in the environment mode (04-REQ-61).
// Pure: the caller passes process.argv.
import type { Issue } from '../core/types/index.ts';
import { lastReporterValue, scanPlaywrightArgs, testArgsFromArgv } from './playwright-args.ts';

/** Interactive options that are not measured reliably (04-REQ-61). */
const INTERACTIVE: ReadonlySet<string> = new Set(['--ui', '--ui-host', '--ui-port', '--debug']);

export interface ArgvWarnings {
  /** RUN_REPORTER_FLAG: printed on stderr only, the package reporter does not run. */
  reporter: Issue | null;
  /** RUN_UNSUPPORTED_FLAG: printed and added to the report warnings. */
  unsupported: Issue | null;
}

/**
 * RUN_REPORTER_FLAG when the last --reporter does not name the package reporter, and
 * RUN_UNSUPPORTED_FLAG for --ui, --ui-host, --ui-port and --debug (04-REQ-61). Best effort.
 */
export function argvWarnings(argv: readonly string[], packageName: string): ArgvWarnings {
  const args = testArgsFromArgv(argv);
  const reporter = lastReporterValue(args);
  const own = reporter !== null && reporter.includes(packageName);
  const interactive = [
    ...new Set(
      scanPlaywrightArgs(args)
        .options.filter((o) => INTERACTIVE.has(o.name))
        .map((o) => o.name),
    ),
  ];
  return {
    reporter:
      reporter === null || own
        ? null
        : {
            code: 'RUN_REPORTER_FLAG',
            message: `--reporter replaces the pw-perf reporter: nothing will be evaluated and no report will be written.`,
            hint: `Remove --reporter from the measurement command, or add ",${packageName}/reporter" to its value.`,
          },
    unsupported:
      interactive.length === 0
        ? null
        : {
            code: 'RUN_UNSUPPORTED_FLAG',
            message: `${interactive.join(', ')}: interactive runs are not measured reliably.`,
            hint: 'Run the measurement with a separate script without these options.',
          },
  };
}
