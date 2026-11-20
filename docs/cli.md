# CLI

The package installs the command `pw-perf` (the long name `playwright-performance-regression` is
an alias of the same command). Run it with `npx pw-perf <command>` from the directory of your
`playwright.config`, or point it to the config with `-c`.

```text
pw-perf <command> [options] [playwright test arguments]
```

| Command                                                      | What it does                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| [`test`](#pw-perf-test)                                      | Measurement run: measure, compare with the thresholds files, fail on regression |
| [`thresholds`](#pw-perf-thresholds)                          | Thresholds run: measure without the gate, then write the thresholds files       |
| [`thresholds --from`](#pw-perf-thresholds---from-reportjson) | Derive the thresholds files from an existing `report.json`, without tests       |
| [`report`](#pw-perf-report)                                  | Render `report.html` again from a `report.json`                                 |
| [`init`](#pw-perf-init)                                      | Guided setup in the current project                                             |

`pw-perf --help` (or `-h`) prints the overview, `pw-perf <command> --help` the options of one
command, and `pw-perf --version` (or `-v`) the installed version.

Messages of the CLI go to stderr; `--help`, `--version` and the thresholds diff of
`thresholds --from` go to stdout.

Colors: the CLI messages, the run summary, the thresholds diff and `init` use the 16 ANSI colors
when the output is a terminal and `TERM` is not `dumb`. Green means success, red an error or a
blocking result, yellow a warning, magenta a result that is not trustworthy, cyan step headers
and commands, dim explanations, hints and default answers, bold headings. The run summary starts
with a separator line and ends with the verdict as a badge (`✔ PASSED`, `! PASSED WITH
WARNINGS`, `✖ FAILED`, `✖ ERROR` on a green, yellow, red or magenta background), the reason and
one `Report:` line with the absolute path of the HTML report. Every colored item also has a
symbol or a word, and the text is the same without colors.

| Variable        | Effect                                                   |
| --------------- | -------------------------------------------------------- |
| `NO_COLOR=1`    | No colors, also in a terminal and with `FORCE_COLOR`.    |
| `FORCE_COLOR=1` | Colors also without a terminal (for example in CI logs). |
| `FORCE_COLOR=0` | No colors.                                               |

## `pw-perf test`

```text
pw-perf test [--env <label>] [--repeat <n>] [playwright test arguments]
```

Runs `playwright test` in perf mode: every measured test runs several times in one worker, the
backend requests and custom measurements are recorded, compared with the thresholds files of the
project, and the run fails when an endpoint got slower or returns more errors.

| Option          | Meaning                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `--env <label>` | Environment label: the run uses `pw-perf-thresholds.<kind>.<label>.json`. Overrides `run.env` of the config. |
| `--repeat <n>`  | Repetitions per test for this run (1 to 1000). Overrides `run.repeat.test`.                                  |
| `-h`, `--help`  | Show the help of the command.                                                                                |

Example: measure only the tests tagged `@perf`:

```sh
npx pw-perf test --grep @perf
```

## `pw-perf thresholds`

```text
pw-perf thresholds [--env <label>] [--repeat <n>] [--prune] [playwright test arguments]
```

Runs the tests in perf mode like `test`, but without failing on violations, and then writes the
thresholds files from the measured values. Review the printed diff (also in
`pw-perf-results/thresholds-diff.md`) and commit the files. See [Thresholds](thresholds.md) for the
whole workflow.

| Option          | Meaning                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `--env <label>` | Environment label: the files `pw-perf-thresholds.<kind>.<label>.json` are written. Overrides `run.env`.  |
| `--repeat <n>`  | Repetitions per test for this run (1 to 1000). Overrides `run.repeat.thresholds`.                        |
| `--prune`       | Remove unlocked entries of keys that were not seen in this run. Not allowed together with a test filter. |
| `-h`, `--help`  | Show the help of the command.                                                                            |

Nothing is written when the run is incomplete or its result cannot be trusted (for example an
interrupted run or too many failed tests); the run then ends with exit code 3.

`--prune` needs the whole measured suite: with `--grep`, `--grep-invert`, `--project`,
`--last-failed`, `--only-changed`, `--test-list`, `--test-list-invert` or test file paths, the
entries of the tests left out would be removed too, so the command stops with
[`CLI_PRUNE_WITH_FILTER`](troubleshooting.md#cli_prune_with_filter).

## `pw-perf thresholds --from <report.json>`

```text
pw-perf thresholds --from <report.json> [--env <label>] [--prune] [--config <file>]
```

Derives the thresholds files from a run report that already exists, without running any test and
without Playwright. Use it to turn the `report.json` of a CI run into thresholds files on your
machine: the files are the same as the ones a thresholds run on that CI machine would write.

| Option            | Meaning                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `--from <file>`   | The `report.json` to derive from (required).                                                   |
| `--env <label>`   | Environment label of the files to write. Default: the label recorded in the report.            |
| `--prune`         | Remove unlocked entries of keys not seen in the report.                                        |
| `--config <file>` | Package config file. Default: see [Package config](#package-config-in-commands-without-tests). |

The command takes no Playwright arguments and no `--repeat`
([`CLI_FROM_WITH_PLAYWRIGHT_ARGS`](troubleshooting.md#cli_from_with_playwright_args)). It writes
the changed thresholds files and `thresholds-diff.md` in `report.dir`, and prints the diff on
stdout. A report whose tests did not pass gives the warning
[`CLI_REPORT_TESTS_FAILED`](troubleshooting.md#cli_report_tests_failed); the thresholds are still
derived.

## `pw-perf report`

```text
pw-perf report [--input <report.json>] [--output <report.html>] [--config <file>]
```

Renders the HTML report again from a run report, without running tests and without Playwright.
The page is the same as the one the run wrote. It is written also when `report.html` is `false`
in the config.

| Option            | Meaning                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `--input <file>`  | Run report to render. Default: `report.json` in `report.dir`.                                  |
| `--output <file>` | HTML file to write. Default: `report.html` next to the input.                                  |
| `--config <file>` | Package config file. Default: see [Package config](#package-config-in-commands-without-tests). |

## `pw-perf init`

```text
pw-perf init [--yes] [--dry-run] [--lang <code>] [--no-tutorial]
```

Sets the package up in the current project. It reads the project files as text (the Playwright
config is never executed), asks a few questions (which tests to measure, repetitions, a
warn-only start, environments, a CI job), shows a diff of every change and applies the changes
after you confirm them. It does not ask for origin labels: requests to the `baseURL` origin get no
label in the endpoint keys and other hosts are labeled with their host; set shorter labels in
`keys.origins`. The default is to measure all tests, also when some are tagged `@perf` and with
`--yes`; when no test is tagged, the wizard shows how to tag them
([`INIT_NO_TAGGED_TESTS`](troubleshooting.md#init_no_tagged_tests)). `npm init playwright-performance-regression`
installs the package and then runs this command.

| Option          | Meaning                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| `-y`, `--yes`   | Take the default answers and write the changes.                             |
| `--dry-run`     | Show the planned changes, write nothing.                                    |
| `--lang <code>` | Language of the wizard: `en` (default), `es`, `fr`, `pl`, `it`, `uk`, `ru`. |
| `--no-tutorial` | Print the manual setup steps and change nothing.                            |
| `-h`, `--help`  | Show the help of the command.                                               |

What it can change:

- a new `pw-perf.config.ts`: the answers that differ from the defaults as code, and every other
  option as a comment with its default value and a one-line description, grouped by section;
- `playwright.config`: the config wrapped in `withPerf()`;
- the file that creates your `test` object: wrapped in `withPerfFixtures()`, or, when the tests
  import `test` directly from `@playwright/test`, those imports switched to
  `playwright-performance-regression/test`;
- `.gitignore`: `pw-perf-results/`;
- `package.json`: the scripts `perf:test` and `perf:thresholds` (one pair per environment);
- a CI job file from the [CI recipes](ci.md).

Layouts it does not recognize (another wrapper around the config, several test objects,
`mergeTests`, existing scripts or CI files with other content) are left as they are, with an
instruction ([`INIT_MANUAL_STEP`](troubleshooting.md#init_manual_step)); see
[Adoption](adoption.md) for those cases. Running `init` again changes nothing that is already
set up. An existing `pw-perf.config.ts` is replaced only after its own confirmation, never with
`--yes`.

In a terminal, `init` first asks whether to set the package up with a guided tutorial. Answering
no (or passing `--no-tutorial`) ends right away with exit code 0 and changes no file: it prints
the manual setup steps and a link to [Adoption](adoption.md). Then it asks for the language of
the wizard; `--lang` skips that question. With `--yes` or without a terminal both questions are
skipped and the wizard runs in `--lang` or English. Only the wizard texts are translated: codes,
file and option names, the written files and the other commands stay in English, and the files
written are the same in every language.

Without a terminal and without `--yes`, `init` prints the plan with the default answers and
writes nothing. Nothing is written before the step that applies the changes, so Ctrl+C before
that step leaves the project untouched.

## Own options and Playwright arguments

`test` and `thresholds` read their own options (`--env`, `--repeat`, `--prune`) anywhere before
`--`, as `--env staging` or `--env=staging`. When an option is given twice, the last value
counts. Every other argument goes to `playwright test` unchanged, in the same order, so the
usual filters work:

```sh
npx pw-perf test --grep @perf --project chromium
npx pw-perf test tests/checkout.spec.ts
```

Arguments after `--` are never read as `pw-perf` options and go to Playwright as they are.

`--config` / `-c` belongs to Playwright in these two commands: it selects the Playwright config.
Only `thresholds --from` and `report` have their own `--config`, for the package config file.

`--repeat` and `--env` are checked before Playwright starts: `--repeat` must be an integer from 1
to 1000, `--env` a label of lowercase letters, digits and `-` (at most 32 characters).

### Refused Playwright options

These options change how the tests run, or split the run, so they cannot be used in perf mode
and the command stops before Playwright starts
([`CLI_UNSUPPORTED_PLAYWRIGHT_OPTION`](troubleshooting.md#cli_unsupported_playwright_option)):

- `--ui`, `--ui-host`, `--ui-port` and `--debug`: use `npx playwright test` for UI mode and
  debugging;
- `--shard`: each shard would see only part of the samples, so the statistics and the gate need
  the whole run in one job.

### `--reporter`

A `--reporter` flag replaces all reporters of the config, including the one `withPerf()` adds.
`pw-perf` therefore appends the package reporter to the value of the last `--reporter` flag, so
`npx pw-perf test --reporter=line` still measures. Without `--reporter`, the reporters of the
config are used as `withPerf()` adjusted them (see
[`run.keepReporters`](configuration.md#runkeepreporters)): a measurement run has hundreds of test
executions, so the `list` reporter is replaced with `dot`, and `dot` is added when no console
reporter is left. `npx pw-perf test --reporter=list` (or `run.keepReporters: ['list']`) keeps
`list`.

### `--list`

With `--list` Playwright only lists the tests. Nothing is measured or written, and the command
ends with Playwright's exit code.

## Playwright in the project

`pw-perf` starts the `playwright test` of your project with Node, without a shell. It looks for
`@playwright/test` from the current directory, or from the directory of the `-c` path when one is
given. In a monorepo you can therefore run it from the root:

```sh
npx pw-perf test -c apps/web/playwright.config.ts
```

Without `@playwright/test` the command stops with
[`CLI_PLAYWRIGHT_NOT_FOUND`](troubleshooting.md#cli_playwright_not_found). A version older than
the lowest supported one (1.57) gives the warning
[`CLI_PLAYWRIGHT_UNSUPPORTED_VERSION`](troubleshooting.md#cli_playwright_unsupported_version)
and the run continues.

Before the run the CLI prints the mode, the repetitions and a tip to measure a subset when no
test filter is given. After the run it prints one result line (tests, performance, exit code),
for example `tests failed · performance result not trustworthy · exit code 3` when too many tests
failed. The paths of the report and, in a thresholds run, of the thresholds diff are the last
lines of the reporter output (`Report:` and `Diff:`), so the CLI does not repeat them.

## Package config in commands without tests

In `test` and `thresholds` the package config is what `playwright.config` passes to
`withPerf()`. `thresholds --from` and `report` do not load the Playwright config, so they find
the package config themselves, in this order:

1. the file given with `--config` (it must exist and load);
2. `pw-perf.config.ts`, `.mts`, `.js`, `.mjs`, `.cjs` or `.json` in the current directory, then in
   the config directory recorded in the report (when it exists on this machine);
3. the config snapshot stored in the report (`thresholds --from`, `report --input`), or the
   defaults (`report` without `--input`).

A config file found by name that cannot be loaded is reported
([`CONFIG_FILE_LOAD_FAILED`](troubleshooting.md#config_file_load_failed)) and the next source is
used. When the file differs from the snapshot in options that change the result, the command
warns with [`CONFIG_SNAPSHOT_DIFFERS`](troubleshooting.md#config_snapshot_differs) and uses the
file. The CLI prints which source it used.

Relative paths (`thresholds.dir`, `report.dir`) are resolved against the directory of the loaded
config file, else the config directory of the report, else the current directory (with the
warning [`CLI_CONFIG_DIR_MISSING`](troubleshooting.md#cli_config_dir_missing)). The CLI prints
this base directory.

TypeScript config files are loaded by Node's built-in type stripping. Imports without a file
extension, `tsconfig` path aliases and `enum` do not work there; the error message says how to
fix them.

## Environment variables and manual mode

The CLI runs Playwright with these variables. You normally never set them yourself:

| Variable               | Meaning                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `PW_PERF_MODE`         | `test` or `thresholds`; perf mode is off when it is unset or empty         |
| `PW_PERF_REPEAT`       | repetitions per test (`--repeat`)                                          |
| `PW_PERF_ENV`          | environment label (`--env`)                                                |
| `PW_PERF_PRUNE`        | `1` to prune in a thresholds run (`--prune`)                               |
| `PW_PERF_RUN_ID`       | id of the run                                                              |
| `PW_PERF_OUTCOME_FILE` | file where the reporter writes the result the CLI turns into its exit code |

An invalid value never turns perf mode off silently: the run stops with
[`MODE_INVALID_VALUE`](troubleshooting.md#mode_invalid_value). When any of these variables is
already set, `pw-perf` warns with
[`CLI_MODE_ALREADY_SET`](troubleshooting.md#cli_mode_already_set) and replaces all of them for
its run.

**Manual mode.** `PW_PERF_MODE=test npx playwright test` also runs in perf mode, without the
CLI. This is meant for setups that cannot call `pw-perf`. You lose what the CLI adds:

- `--ui`, `--debug`, `--shard` and `--prune` with a test filter are not refused (a sharded run is
  still detected by the reporter, [`RUN_SHARDED`](troubleshooting.md#run_sharded));
- a `--reporter` flag replaces the package reporter, so nothing is measured;
- the exit code is Playwright's: 1 when the performance result or the tests failed, else 0. The
  codes 2 and 3 below exist only through `pw-perf`.

## Signals

Ctrl+C (SIGINT) and SIGTERM are forwarded to Playwright, which stops the tests and lets the
reporters finish. A second Ctrl+C within 5 seconds kills Playwright at once. The CLI waits for
Playwright to end and exits with 130 (SIGINT) or 143 (SIGTERM). An interrupted thresholds run
writes no thresholds files.

## Exit codes

| Code       | Meaning                                                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0          | OK. Also with warnings, with tolerated violations, with `gate.warnOnly`, and with a few failed tests (they are reported as a warning).                                                          |
| 2          | Performance regression: at least one blocking violation (`test` only).                                                                                                                          |
| 3          | Tool or config error, or a result that cannot be trusted: an invalid option or config, too many failed tests, an interrupted or timed-out run, a sharded run, a file that could not be written. |
| 130 / 143  | Interrupted by SIGINT / SIGTERM.                                                                                                                                                                |
| Playwright | With `--list`, Playwright's own exit code.                                                                                                                                                      |

`thresholds`, `thresholds --from`, `report` and `init` end with 0 or 3 (and 130/143 when
interrupted). A run that wrote no result, for example because `playwright.config` does not use
`withPerf()` or no test matched the filters, ends with 3 and
[`CLI_OUTCOME_MISSING`](troubleshooting.md#cli_outcome_missing).

In CI, treat 2 as "performance regression" and 3 as "the measurement itself did not work"; the
[CI recipes](ci.md) map 2 to a soft failure where the platform supports it.

## Output files

| File                                                                            | Written by                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `pw-perf-results/report.json`                                                   | every run (`report.dir`)                                |
| `pw-perf-results/report.html`                                                   | every run unless `report.html` is `false`; `report`     |
| `pw-perf-results/thresholds-diff.md`                                            | `thresholds`, `thresholds --from`                       |
| `pw-perf-thresholds.api[.<env>].json`, `pw-perf-thresholds.custom[.<env>].json` | `thresholds`, `thresholds --from` (in `thresholds.dir`) |

Paths are relative to the directory of `playwright.config` and follow
[`report.dir`](configuration.md#reportdir), [`thresholds.dir`](configuration.md#thresholdsdir) and
[`thresholds.filePrefix`](configuration.md#thresholdsfileprefix). Commit the thresholds files;
keep `pw-perf-results/` out of version control.
