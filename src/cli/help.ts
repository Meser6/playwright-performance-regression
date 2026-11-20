// Help texts of the CLI (04, chapters 3 and 6; 04-REQ-21). Printed on stdout.
import { LANGUAGES } from './init/messages.ts';
import { CLI_COMMAND } from '../core/types/index.ts';
import type { HelpTopic } from './parse.ts';

const REPEAT_NOTE = [
  'Note: every test runs several times in one worker. Tests that create data with unique',
  'constraints may conflict between repetitions: make the data unique per repetition, or',
  'leave such tests out with --grep-invert.',
];

const EXIT_CODES = [
  'Exit codes: 0 ok (failed tests are reported as a warning) · 2 performance regression ·',
  '3 tool or config error, or an untrustworthy result (too many failed tests, incomplete run)',
  '· 130/143 interrupted (SIGINT/SIGTERM)',
];

const PASS_THROUGH = [
  'All other arguments go to "playwright test" unchanged; arguments after "--" are never read',
  `as ${CLI_COMMAND} options. --ui, --debug and --shard are not supported. By default only`,
  'Chromium projects are measured; other projects are left out of the run (option',
  '"run.projects").',
];

const GENERAL = [
  `Usage: ${CLI_COMMAND} <command> [options] [playwright test arguments]`,
  '',
  'Commands:',
  '  test                       Measurement run: measure, evaluate against the thresholds, fail on regression',
  '  thresholds                 Thresholds run: measure without the gate, then write the thresholds files',
  '  thresholds --from <file>   Derive the thresholds from an existing report.json (no tests)',
  '  report                     Render the HTML report again from report.json',
  '  init                       Guided setup in this project',
  '',
  'Options (test, thresholds):',
  '  --env <label>      Environment label; selects pw-perf-thresholds.<kind>.<label>.json',
  '  --repeat <n>       Repetitions per test for this run',
  '  --prune            (thresholds) Remove unlocked entries of keys not seen in this run',
  '',
  ...PASS_THROUGH,
  '',
  `Run "${CLI_COMMAND} <command> --help" for the options of a command, "${CLI_COMMAND} --version"`,
  'for the version.',
  '',
  ...REPEAT_NOTE,
  '',
  ...EXIT_CODES,
];

const TEST = [
  `Usage: ${CLI_COMMAND} test [--env <label>] [--repeat <n>] [playwright test arguments]`,
  '',
  'Runs the tests in perf mode, measures the backend requests, evaluates them against the',
  'thresholds files and fails on a regression.',
  '',
  'Options:',
  '  --env <label>   Environment label; selects pw-perf-thresholds.<kind>.<label>.json (overrides run.env)',
  '  --repeat <n>    Repetitions per test for this run (overrides run.repeat.test)',
  '  -h, --help      Show this help',
  '',
  ...PASS_THROUGH,
  '',
  `Example: ${CLI_COMMAND} test --grep @perf`,
  '',
  ...REPEAT_NOTE,
  '',
  ...EXIT_CODES,
];

const THRESHOLDS = [
  `Usage: ${CLI_COMMAND} thresholds [--env <label>] [--repeat <n>] [--prune] [playwright test arguments]`,
  `       ${CLI_COMMAND} thresholds --from <report.json> [--env <label>] [--prune] [--config <file>]`,
  '',
  'Runs the tests in perf mode without the gate and writes the thresholds files, or derives them',
  'from an existing run report without running tests (--from).',
  '',
  'Options:',
  '  --env <label>      Environment label; the files pw-perf-thresholds.<kind>.<label>.json are written',
  '                     (with --from: default is the label of the report)',
  '  --repeat <n>       Repetitions per test for this run (overrides run.repeat.thresholds)',
  '  --prune            Remove unlocked entries of keys not seen in the run; not with a test filter',
  '  --from <file>      Derive the thresholds from this report.json; no Playwright arguments',
  '  --config <file>    (with --from) Package config file; default: pw-perf.config.* in the current',
  '                     directory or the config directory of the report, else the report snapshot',
  '  -h, --help         Show this help',
  '',
  ...PASS_THROUGH,
  '',
  ...REPEAT_NOTE,
  '',
  'Exit codes: 0 ok · 3 tool or config error, or an untrustworthy run (nothing is written)',
  '· 130/143 interrupted (SIGINT/SIGTERM)',
];

const REPORT = [
  `Usage: ${CLI_COMMAND} report [--input <report.json>] [--output <report.html>] [--config <file>]`,
  '',
  'Renders the HTML report again from a run report, without running tests.',
  '',
  'Options:',
  '  --input <file>     Run report; default: report.json in report.dir',
  '  --output <file>    HTML file; default: report.html next to the input',
  '  --config <file>    Package config file; default: pw-perf.config.* in the current directory',
  '  -h, --help         Show this help',
  '',
  'Exit codes: 0 ok · 3 error',
];

const INIT = [
  `Usage: ${CLI_COMMAND} init [--yes] [--dry-run] [--lang <code>] [--no-tutorial]`,
  '',
  'Guided setup of the package in this project: asks a few questions, shows a diff of every',
  'change and applies it after confirmation. Files it does not recognize are left unchanged',
  'with instructions. Without a terminal and without --yes it only shows the planned changes.',
  '',
  'Options:',
  '  -y, --yes      Accept the default answers and write the changes',
  '  --dry-run      Show the planned changes only',
  `  --lang <code>  Language of the wizard: ${LANGUAGES.join(', ')} (default: en, or asked)`,
  '  --no-tutorial  Print the manual setup steps and change nothing',
  '  -h, --help     Show this help',
  '',
  'Exit codes: 0 done (also with manual steps left) · 3 error · 130 interrupted',
];

const TOPICS: Record<HelpTopic, string[]> = {
  test: TEST,
  thresholds: THRESHOLDS,
  report: REPORT,
  init: INIT,
};

export function helpText(command?: HelpTopic): string {
  return `${(command === undefined ? GENERAL : TOPICS[command]).join('\n')}\n`;
}
