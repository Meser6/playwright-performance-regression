// Help text (04, chapter 6; 04-REQ-21), printed on stdout after CLI_UNKNOWN_COMMAND (04-REQ-01).
// It shows only the environment form, the user's own test command with PW_PERF_* variables, and
// the setup command with its variables (04-REQ-70, D-43): the package has no commands or options.
import { DEFAULT_CONFIG } from '../core/config/index.ts';
import { INIT_COMMAND } from '../core/types/index.ts';
import { LANGUAGES } from './init/messages.ts';

const HELP = [
  'Run your usual test command with PW_PERF_MODE set, e.g.',
  '  PW_PERF_MODE=test npm run e2e         Measurement run: evaluate against the thresholds',
  '  PW_PERF_MODE=thresholds npm run e2e   Thresholds run: write the thresholds files',
  '  PW_PERF_MODE=check npm run e2e        Dry run: what would be measured and how long it takes',
  'Without a script: PW_PERF_MODE=test npx playwright test --grep @perf.',
  'Windows: npx cross-env PW_PERF_MODE=test npm run e2e (PowerShell and cmd: see docs/cli.md).',
  '',
  'Variables (set in front of the test command):',
  '  PW_PERF_MODE           test, thresholds or check; perf mode is off when it is unset',
  '  PW_PERF_ENV=<label>    Environment label; selects pw-perf-thresholds[.steps].<label>.json',
  '  PW_PERF_PASSES=<n>     Passes of the test command (each test runs once per pass)',
  '  PW_PERF_PRUNE=1        (thresholds) Remove unlocked entries of keys not seen in this run',
  '  PW_PERF_MAX_TESTS=<n>  (check) At most n measured tests, the first of each file (default 10)',
  '',
  `Setup: ${INIT_COMMAND} (guided; changes nothing without asking). Wizard variables:`,
  `  PW_PERF_LANG=<code>    Wizard language (${LANGUAGES.join(', ')}) without the question`,
  '  PW_PERF_DRY_RUN=1      Show the planned changes only, write nothing',
  '  PW_PERF_NO_TUTORIAL=1  Print the manual setup steps only, change nothing',
  '',
  'The projects your test command selects are measured (all without --project); setup and',
  'teardown projects run once and are not measured. --ui and --debug are not measured reliably.',
  '',
  'Note: the test command runs once per pass (run.passes), with its data setup steps, in one',
  'worker. Tests that create data with unique constraints must make it unique per pass, or be',
  'left out with --grep-invert.',
  '',
  `The exit code is the one of Playwright; the result is in ${DEFAULT_CONFIG.report.dir}/outcome.json:`,
  'exitCode 0 ok (failed tests are reported as a warning) · 2 performance regression · 3 tool or',
  'config error, or an untrustworthy result (too many failed tests, incomplete run).',
];

/** The help (04-REQ-70: environment form only). */
export function helpText(): string {
  return `${HELP.join('\n')}\n`;
}
