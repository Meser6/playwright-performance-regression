# Running

The package has no commands or options of its own. You run the test command your project already
has, with environment variables in front of it. Playwright rejects unknown command line flags, so
every setting of a run is a `PW_PERF_*` variable:

| Goal              | Command (bash, zsh, Git Bash)                        |
| ----------------- | ---------------------------------------------------- |
| measurement run   | `PW_PERF_MODE=test npm run e2e`                      |
| thresholds run    | `PW_PERF_MODE=thresholds npm run e2e`                |
| dry run (check)   | `PW_PERF_MODE=check npm run e2e`                     |
| without a script  | `PW_PERF_MODE=test npx playwright test --grep @perf` |
| environment label | `PW_PERF_MODE=test PW_PERF_ENV=qa npm run e2e:qa`    |

Run the command from the directory you always run your tests from. Everything the script does
still happens: its variables, setup steps and Playwright flags. The variable reaches Playwright
through npm and the shell of the script. Without `PW_PERF_MODE` your tests run exactly as before.

To set the package up, run `npm init playwright-performance-regression` (see
[Guided setup](#guided-setup)).

## Variables

| Variable            | Meaning                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `PW_PERF_MODE`      | `test`, `thresholds` or `check`; perf mode is off when it is unset or empty                                  |
| `PW_PERF_ENV`       | environment label: the run uses `pw-perf-thresholds[.steps].<label>.json`; overrides `run.env` of the config |
| `PW_PERF_PASSES`    | passes of the test command for this run (1 to 1000); overrides `run.passes.test` or `run.passes.thresholds`  |
| `PW_PERF_PRUNE`     | `1` in a thresholds run: remove unlocked entries of keys that were not seen in this run                      |
| `PW_PERF_MAX_TESTS` | in a check: measured tests to run, 1 to 1000 (default 10)                                                    |
| `PW_PERF_PASS`      | `k/N`, set by the package for passes 2 to N; do not set it yourself                                          |
| `PW_PERF_RUN_ID`    | id of the run, set by the package; do not set it yourself                                                    |

An invalid value never turns perf mode off silently: the run stops with
[`MODE_INVALID_VALUE`](troubleshooting.md#mode_invalid_value). `PW_PERF_ENV` is a label of
lowercase letters, digits and `-` (at most 32 characters).

`PW_PERF_PRUNE=1` needs the whole measured suite: with `--grep`, `--grep-invert`, `--project`,
`--last-failed`, `--only-changed`, `--test-list`, `--test-list-invert` or test file paths in the
command, the entries of the tests left out would be removed too, so the files are written without
pruning and the run warns with [`RUN_PRUNE_SKIPPED`](troubleshooting.md#run_prune_skipped).

## Windows

On Windows use `npx cross-env PW_PERF_MODE=test npm run e2e` (cmd and PowerShell). Without
cross-env: PowerShell `$env:PW_PERF_MODE='test'; npm run e2e; Remove-Item Env:PW_PERF_MODE`, cmd
`set "PW_PERF_MODE=test" && npm run e2e && set "PW_PERF_MODE="`. A variable set with `$env:` or
`set` stays in the terminal session: remove it, or the next normal run is in perf mode too. In CI,
set `PW_PERF_MODE` in the `env` of the job.

`cross-env` sets the variable and starts the rest of the line as one command with its arguments,
so `npx cross-env PW_PERF_MODE=test npm run e2e -- --grep "@cart"` works as typed. In a chain
(`npx cross-env PW_PERF_MODE=test npm run seed && npm run e2e`) the shell runs the part after
`&&` without the variable; put the chain in a `package.json` script instead.

## Passes

A run has several passes (`run.passes`: 5 for `test`, 10 for `thresholds`; `PW_PERF_PASSES=3` for
one run). You start the command once; when a pass ends, the package runs the same command again,
one pass after the other, and evaluates all passes together after the last one: one report, one
result. Every test runs once per pass, and so does everything the script does before Playwright
(seeding data, resetting accounts), so data created by a test is fresh in every pass.

- The command of the next pass is the npm, pnpm or yarn script that started Playwright (with the
  arguments you added after `--`), or the Playwright command line itself without a script. A
  script called from another script (`e2e:qa` runs `npm run e2e`) is repeated from the inner one:
  its variables are kept, the steps of the outer script before it do not run again.
- Each pass writes `pw-perf-results/pass-<k>.json`; the first pass merges them. A pass that writes
  no file (for example its setup step failed) gives
  [`RUN_PASS_FAILED`](troubleshooting.md#run_pass_failed) and the other passes are evaluated.
- Ctrl+C stops the run: the following passes do not start and nothing is evaluated.
- Playwright's `retries` apply in perf mode too: every attempt is measured, and a test that passes
  on a retry counts as passed (flaky).

## Start banner

At the start the reporter shows a frame with the mode, the measured projects, tests × passes, an
estimate of the run time (from the last `report.json`, else 30 s per test) and where the report
goes. The frame is information only: the run starts right away, in a terminal and in CI. To stop
a run, press Ctrl+C. The frame comes after `globalSetup` and the `webServer` start, because only
then the number of tests is known.

## Dry run (check)

```sh
PW_PERF_MODE=check npm run e2e
PW_PERF_MODE=check PW_PERF_MAX_TESTS=20 npm run e2e
```

A dry run before the first measurement. It runs the first test of each file of the measured
projects once, up to `PW_PERF_MAX_TESTS` tests (default 10; setup and teardown projects run in
full), and prints what would be measured: the projects with their `baseURL`, the reporters, the
origins with their labels and where each label comes from, the top keys, the state of the
thresholds files, warnings, and an estimate of the measurement and thresholds runs (an order of
magnitude: passes × (setup time + tests × the mean test time)). Nothing is evaluated and no file
is written.

When hosts look generated per CI instance, the check warns with
[`CHECK_RANDOM_HOST`](troubleshooting.md#check_random_host) and proposes host patterns for
`keys.origins` (see [Dynamic environments](dynamic-environments.md)).

The skipped tests are skipped by the pw-perf fixture before their body; `beforeAll` hooks of their
files may still run. A check has one pass and never prunes. Playwright's exit code applies and no
`outcome.json` is written.

## Exit code and result

The exit code is Playwright's: 1 when a test failed or the performance result is not 0, else 0.
The exact result is in `pw-perf-results/outcome.json` (`exitCode` 0, 2 or 3, see
[Exit codes](#exit-codes)), written next to `report.json` and removed at the start of every run,
so a CI job never reads an old one. Read it with
`node -p "require('./pw-perf-results/outcome.json').exitCode"` or `jq .exitCode`. The summary ends
with a line like `Outcome: performance failed · exit code 2 in …/outcome.json (Playwright exits
with 1)`.

A script that runs Playwright more than once overwrites the report and `outcome.json`; the last
run counts. Steps after Playwright in the script (`&& node upload.js`) run only when Playwright
exits with 0.

### Exit codes

| `exitCode` | Meaning                                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0          | OK. Also with warnings, with tolerated violations, and with a few failed tests (they are reported as a warning).                                                                                  |
| 2          | Performance regression: at least one blocking violation (`test` only).                                                                                                                            |
| 3          | Tool or config error, or a result that cannot be trusted: an invalid variable or config, too many failed tests, an interrupted or timed-out run, a sharded run, a file that could not be written. |

A thresholds run ends with 0 or 3. When `outcome.json` is missing after the run, the reporter did
not run (for example `playwright.config` does not use `withPerf()` or no test matched the
filters): treat it as 3.

In CI, treat 2 as "performance regression" and 3 as "the measurement itself did not work"; the
[CI recipes](ci.md) map 2 to a soft failure where the platform supports it.

## Playwright flags in your command

Flags in your test command (also inside the npm script) are not refused; the package warns
instead, before the tests start:

- [`RUN_REPORTER_FLAG`](troubleshooting.md#run_reporter_flag): a `--reporter` flag replaces all
  reporters of the config, including the one `withPerf()` adds, so nothing is evaluated. Remove it
  from the measurement command, or add `,playwright-performance-regression/reporter` to its value.
- [`RUN_UNSUPPORTED_FLAG`](troubleshooting.md#run_unsupported_flag): `--ui`, `--ui-host`,
  `--ui-port` and `--debug` are not measured reliably; use a separate command for them.
- [`RUN_PRUNE_SKIPPED`](troubleshooting.md#run_prune_skipped): `PW_PERF_PRUNE=1` with a test
  filter (see [Variables](#variables)).

A sharded run (`--shard`) sees only part of the samples, so the statistics and the gate need the
whole run in one job ([`RUN_SHARDED`](troubleshooting.md#run_sharded)). With `--list` Playwright
only lists the tests; nothing is measured or written.

Without `--reporter`, the reporters of the config are used as `withPerf()` adjusted them (see
[`run.keepReporters`](configuration.md#runkeepreporters)): a measurement run has hundreds of test
executions, so the `list` reporter is replaced with `dot`, and `dot` is added when no console
reporter is left. `run.keepReporters: ['list']` keeps `list`.

## Colors

The run summary, the thresholds diff and the guided setup use the 16 ANSI colors when the output
is a terminal and `TERM` is not `dumb`. Green means success, red an error or a blocking result,
yellow a warning, magenta a result that is not trustworthy, cyan step headers and commands, dim
explanations, hints and default answers, bold headings. The run summary starts with a separator
line and shows errors and warnings in framed boxes, the counters and the violations in tables,
and ends with the verdict in a box (`✅ PASSED`, `⚠ PASSED WITH WARNINGS`, `❌ FAILED`,
`❌ ERROR`, with a badge on a green, yellow, red or magenta background), the reason and one
`Report:` line with the absolute path of the HTML report. Every colored item also has an emoji or
a word, and the text is the same without colors.

| Variable        | Effect                                                       |
| --------------- | ------------------------------------------------------------ |
| `NO_COLOR=1`    | No colors, also in a terminal and with `FORCE_COLOR`.        |
| `FORCE_COLOR=1` | Colors also without a terminal (for example in CI logs).     |
| `FORCE_COLOR=0` | No colors.                                                   |
| `TERM=dumb`     | No colors, ASCII frames (`+`, `-`, `\|`), `✔ ! ✖` for emoji. |

## Guided setup

```sh
npm init playwright-performance-regression
# or: pnpm create playwright-performance-regression · yarn create playwright-performance-regression
```

It installs the package as a dev dependency when it is missing and sets it up in the current
project. Run it again at any time; in a project that is already set up it changes nothing. It
reads the project files as text (the Playwright config is never executed), asks a few questions
(all tests or only those tagged `@perf`, passes, what to measure, the threshold headroom preset,
your test command, the CI jobs), shows a diff of every change and applies the changes after you
confirm them. At the end it offers a check (your test command with `PW_PERF_MODE=check`) and
prints the exact commands for your project, e.g. `Run: PW_PERF_MODE=test npm run e2e:qa`.

The test command question suggests the command of your package manager (`npx playwright test`,
`pnpm exec playwright test` or `yarn playwright test`); press Enter to keep it, or type the
command you usually run, e.g. `npm run e2e:qa`, without `PW_PERF_` variables. Type `skip` to keep
the suggestion and skip the check. The wizard takes the command as typed: the summary puts
`PW_PERF_MODE=<mode> ` in front of it (on Windows `npx cross-env PW_PERF_MODE=<mode> `), the CI
jobs run it with `PW_PERF_MODE` in the job environment (quoted where YAML or Groovy need it), and
the check runs it through your shell (`$SHELL`, else `/bin/sh`; on Windows `%ComSpec%`, usually
cmd) with `PW_PERF_MODE=check` in its environment. A prefix only reaches the first command of a
chain (`a && b`), so the wizard warns about chains: put them in a `package.json` script and type
`npm run <script>`. The CI jobs run on Linux: fix a command written for cmd or PowerShell there. It does not ask for origin labels: requests to the
`baseURL` origin get no label in the endpoint keys and other hosts are labeled with their host;
set shorter labels in `keys.origins`. The default is to measure all tests, also when some are
tagged `@perf`; when no test is tagged, the wizard shows how to tag them
([`INIT_NO_TAGGED_TESTS`](troubleshooting.md#init_no_tagged_tests)). Choosing `@perf` writes
`run: { grep: '@perf' }` to `pw-perf.config.ts`; your commands stay the same.

What it can change:

- a new `pw-perf.config.ts`: the answers that differ from the defaults as code, and every other
  option as a comment with its default value and a one-line description, grouped by section;
- `playwright.config`: the config wrapped in `withPerf()`;
- your fixtures module (one file that exports `test` created with `.extend()` and contains no
  tests): wrapped in `withPerfFixtures()`. Test files are never changed; in every other layout
  the wizard shows a red box with the code to paste
  ([`INIT_TEST_OBJECT_MANUAL`](troubleshooting.md#init_test_object_manual));
- `.gitignore`: `pw-perf-results/`;
- a CI file from the [CI recipes](ci.md) with a manual thresholds job and a weekly measurement
  job that run your test command.

`package.json` is never changed. Scripts `perf:*` written by an earlier version of the wizard no
longer work (they call a runner that was removed); the summary lists them so you can remove them.

Layouts it does not recognize (another wrapper around the config, existing CI files with other
content) are left as they are, with an
instruction ([`INIT_MANUAL_STEP`](troubleshooting.md#init_manual_step)); see
[Adoption](adoption.md) for those cases. An existing `pw-perf.config.ts` is replaced only after
its own confirmation.

In a terminal, the wizard first asks whether to set the package up with a guided tutorial.
Answering no ends right away and changes no file: it prints the manual setup steps and a link to
[Adoption](adoption.md). Then it asks for the language of the wizard: `en`, `es`, `fr`, `pl`,
`it`, `uk` or `ru`. Only the wizard texts are translated: codes, file and option names, the
written files and the other commands stay in English, and the files written are the same in every
language.

Without a terminal the wizard prints the plan with the default answers in English and writes
nothing; run it again in a terminal to apply the changes. Nothing is written before the step that
applies the changes, so Ctrl+C before that step leaves the project untouched. In a project with
the package installed, `npx pw-perf` starts the same wizard.

The setup takes no arguments; these variables change it:

| Variable              | Meaning                                                                        |
| --------------------- | ------------------------------------------------------------------------------ |
| `PW_PERF_LANG`        | wizard language without the question: `en`, `es`, `fr`, `pl`, `it`, `uk`, `ru` |
| `PW_PERF_DRY_RUN`     | `1`: show the planned changes (diffs) only, also in a terminal; write nothing  |
| `PW_PERF_NO_TUTORIAL` | `1`: print the manual setup steps only and change nothing                      |

For example `PW_PERF_LANG=pl npm init playwright-performance-regression`. An invalid value stops
the setup with [`MODE_INVALID_VALUE`](troubleshooting.md#mode_invalid_value), and any argument
with [`CLI_UNKNOWN_COMMAND`](troubleshooting.md#cli_unknown_command).

## Output files

| File                                      | Written by                                |
| ----------------------------------------- | ----------------------------------------- |
| `pw-perf-results/report.json`             | every run (`report.dir`)                  |
| `pw-perf-results/report.html`             | every run unless `report.html` is `false` |
| `pw-perf-results/outcome.json`            | every `test` and `thresholds` run         |
| `pw-perf-results/thresholds-diff.md`      | thresholds runs                           |
| `pw-perf-thresholds[.steps][.<env>].json` | thresholds runs (in `thresholds.dir`)     |

Paths are relative to the directory of `playwright.config` and follow
[`report.dir`](configuration.md#reportdir), [`thresholds.dir`](configuration.md#thresholdsdir) and
[`thresholds.filePrefix`](configuration.md#thresholdsfileprefix). Commit the thresholds files;
keep `pw-perf-results/` out of version control.

Every `test` and `thresholds` run empties `report.dir` when its first test starts, so it holds
only the files of the last run; keep nothing else in it. The folder is left alone when it is the
project directory, holds thresholds files or otherwise does not look like a results folder
([`RUN_REPORT_DIR_NOT_CLEANED`](troubleshooting.md#run_report_dir_not_cleaned)). A check
removes nothing.
