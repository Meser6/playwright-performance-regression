# Troubleshooting

Every problem the package reports carries a code in capital letters, such as
`THRESHOLDS_FILE_MISSING`. This page has one section per code: what it means, what usually causes
it and how to fix it. Search the page for the code you see.

## Where codes appear

- **Console summary** at the end of a perf-mode run: tool errors under `Errors:` (marked `✖`),
  then up to 10 warnings under `Warnings:` (marked `!`), each as `CODE: message` with an indented
  `Hint:` line.
- **`perf-results/report.json`**: the arrays `toolErrors` and `warnings` hold every issue of the
  run with its code, message and hint.
- **`perf-results/report.html`**: the same warnings and tool errors near the top of the page.
- **CLI output (stderr)**: errors of the `pw-perf` command itself (`CLI_*`, `INIT_*`, config file
  problems of the commands that run no tests).
- **Playwright output**: an invalid package config stops Playwright while it loads
  `playwright.config` with a list of `CONFIG_*` problems; a few rare collector and reporter
  failures are printed as a single line on stderr.

## Severity and exit codes

| Kind               | Effect                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Tool error         | The result cannot be trusted or the run could not be set up. The run ends with exit code **3**.                                  |
| Blocking violation | A key exceeded its thresholds in `test` mode. Exit code **2**. This is not an error code but a regression; see [faq.md](faq.md). |
| Warning            | Something to look at. The run continues and the exit code is not changed by it.                                                  |
| Info / diagnostic  | Recorded for context only; measurement works.                                                                                    |

The full exit code table is in [cli.md](cli.md#exit-codes). Options are described in
[configuration.md](configuration.md); thresholds in [thresholds.md](thresholds.md); setup in
existing projects in [adoption.md](adoption.md); CI in [ci.md](ci.md).

## Contents

- [Configuration and perf mode](#configuration-and-perf-mode)
- [CLI](#cli)
- [init](#init)
- [Collector and custom measurements](#collector-and-custom-measurements)
- [Endpoint keys](#endpoint-keys)
- [Statistics](#statistics)
- [Run and reporter](#run-and-reporter)
- [Evaluation](#evaluation)
- [Thresholds derivation](#thresholds-derivation)
- [Files and schemas](#files-and-schemas)
- [HTML report](#html-report)

## Configuration and perf mode

Configuration errors are collected and reported together, each with the option path. Inside a
test run they stop Playwright while it loads the config, so the `pw-perf` command then ends with
[`CLI_OUTCOME_MISSING`](#cli_outcome_missing) and exit code 3; read the list printed above it.

### CONFIG_UNKNOWN_OPTION

**Error.** The package config has an option the package does not know, usually a typo or an
option at the wrong level. When a known name is close, the message suggests it ("Did you
mean ...?"). Rename or remove the option; [configuration.md](configuration.md) lists every
option.

### CONFIG_INVALID_TYPE

**Error.** An option has the wrong type, for example a string where a number is expected. Also
reported for `keys.keyBuilder` when it is not a function, when it is used in a `.json` config
file (functions cannot be written in JSON; move the config to a `.ts` or `.js` file) or when a
config snapshot in a report was edited. Fix the value as shown in the hint.

### CONFIG_INVALID_VALUE

**Error.** An option has the right type but an invalid value: out of range, not one of the
allowed values, or inconsistent with another option. Examples: time limits that decrease from
median to percentile to p99, a lower bound above its upper bound, a percentile level below
`p50`, a rule with a smaller `minSamples` than the median rule, every rule disabled without
`gate.warnOnly`, or an `--env` / `--repeat` value (or `PW_PERF_ENV` / `PW_PERF_REPEAT`) out of
range. The message names the option and the value received.

### CONFIG_INVALID_REGEX

**Error.** A `{ "regex": ..., "flags": ... }` pattern in `measure.include`, `measure.exclude` or
the key options does not compile as a JavaScript regular expression. The message contains the
reason from the regex engine. Fix the expression or use a plain substring instead.

### CONFIG_PERCENTILE_IS_P99

**Warning.** `checks.time.percentile.level` is `"p99"`, so the percentile rule checks the same
value as the separate p99 rule. Use a lower level such as `"p95"`, or disable `checks.time.p99`.

### CONFIG_DUPLICATE_ORIGIN_LABEL

**Warning.** Two or more origins get the same label, so their requests end up in the same
endpoint keys. It comes from `keys.origins` entries with the same label, or from the `baseURL` of
several measured projects (each `baseURL` origin gets the empty label unless `keys.origins`
labels it). Give each origin its own label, unless merging their keys is what you want.

### CONFIG_RESOURCE_TYPE_LONG_LIVED

**Warning.** `measure.resourceTypes` includes `"eventsource"`. Server-sent event connections
normally stay open for the whole test and are recorded as `PENDING` samples, which adds wait time
at the end of each test. Remove `"eventsource"` unless those requests finish inside the test.

### CONFIG_UNKNOWN_PROJECT

**Error.** `run.projects` names a project that is not in the Playwright config. The message lists
the available names. Use project names exactly as in `playwright.config`, or `"auto"`.

### CONFIG_NO_MEASURED_PROJECT

**Error.** No project would be measured. With `run.projects: "auto"` only Chromium projects that
are not a dependency or teardown of another project are measured, and the config has none (or it
has `projects: []`). List the projects to measure in `run.projects`.

### CONFIG_MULTIPLE_ENGINES

**Warning.** The measured projects use more than one browser engine (for example Chromium and
Firefox). Their samples go into the same keys and mix timings of different engines. Measure one
engine per run: list projects of one engine in `run.projects`.

### CONFIG_SLOW_MO

**Warning.** `use.launchOptions.slowMo` is greater than 0 in the Playwright config. It delays
every browser action and distorts the measured times. Remove `slowMo` for perf-mode runs.

### CONFIG_CHANGED_IN_PROCESS

**Warning.** `withPerf()` was called more than once in the same process with a different package
config; the last call wins. This happens when several config files wrap themselves or a shared
base config is wrapped as well as the final one. Apply `withPerf()` once, to the config that is
actually run.

### NOT_WRAPPED_WITH_PERF

**Warning.** Perf mode is on, but `withPerf()` was not applied to the Playwright config, so the
default package config is used and every project is treated as measured. Wrap the config:
`export default withPerf(defineConfig({ ... }), perfConfig)` with `withPerf` from
`playwright-performance-regression/config`, or run `npx pw-perf init`. Through the CLI this
usually ends in [`CLI_OUTCOME_MISSING`](#cli_outcome_missing).

### MODE_INVALID_VALUE

**Error.** A `PW_PERF_*` environment variable has an invalid value: `PW_PERF_MODE` other than
`test` or `thresholds`, `PW_PERF_REPEAT` that is not a positive integer, `PW_PERF_ENV` that is not
a valid environment label, or `PW_PERF_PRUNE` other than `1`. An invalid value never silently
turns perf mode off. Fix or unset the variable; normally let `npx pw-perf test` set them.

### CONFIG_FILE_NOT_FOUND

**Error (exit code 3).** The file given with `--config` to `pw-perf thresholds --from` or
`pw-perf report` does not exist. The path is resolved against the current directory.

### CONFIG_FILE_LOAD_FAILED

**Error with `--config`, warning otherwise.** The package config file (`pw-perf.config.*`) could
not be loaded by a command that runs no tests. Node loads TypeScript files itself, without a
bundler, so imports without a file extension, `tsconfig` path aliases and `enum`s fail; the hint
names the fix. Without `--config` the command falls back to the config snapshot stored in the
report.

### CONFIG_SNAPSHOT_DIFFERS

**Warning.** The package config file differs from the config the report was recorded with, in
options that change the result (the message lists up to 10 option paths). The file is used. If
the run used other settings on purpose, check the result, or run the measurement again with the
current config.

## CLI

Errors of the `pw-perf` command end it with exit code 3 before Playwright starts, unless noted.

### CLI_UNKNOWN_COMMAND

**Error.** No command or an unknown command was given. The commands are `test`, `thresholds`,
`report` and `init`; run `npx pw-perf --help`.

### CLI_INVALID_OPTION

**Error.** An option has an invalid value (for example `--repeat 0`), takes no value but got one,
belongs to another command (`--prune` or `--from` with `test`, `--input` with
`thresholds --from`), or the command does not take the argument. Run
`npx pw-perf <command> --help` for the options.

### CLI_MISSING_ARGUMENT

**Error.** An option that needs a value has none, for example `--env` at the end of the command
line or `--env=`. Write `--env <value>` or `--env=<value>`.

### CLI_UNSUPPORTED_PLAYWRIGHT_OPTION

**Error.** `--ui`, `--ui-host`, `--ui-port`, `--debug` or `--shard` was passed. UI mode and
debugging change how tests run and their timings; with sharding each machine would see only part
of the samples. Use `npx playwright test` for these.

### CLI_PRUNE_WITH_FILTER

**Error.** `--prune` was combined with a test filter (`--grep`, `--grep-invert`, `--project`,
`--last-failed`, `--only-changed`, `--test-list` or file paths). Pruning removes entries of keys
not seen in the run, so it would delete the entries of every test left out. Run `--prune` on the
full measurement set, or leave it out.

### CLI_FROM_WITH_PLAYWRIGHT_ARGS

**Error.** `pw-perf thresholds --from <report.json>` runs no tests, so it takes no Playwright
arguments and no `--repeat`. Use only `--from`, `--env`, `--prune` and `--config`, or drop
`--from` to run the tests.

### CLI_MODE_ALREADY_SET

**Warning.** Some `PW_PERF_*` variables were already set in the environment. The CLI removes them
and sets its own for this run. Use the CLI options (`--env`, `--repeat`, `--prune`) instead; set
the variables yourself only for manual mode with `npx playwright test`.

### CLI_PLAYWRIGHT_NOT_FOUND

**Error.** `@playwright/test` cannot be resolved from the project directory (the current
directory, or the directory of `-c <config>`). Install it, run the command from the project
directory, or pass `-c path/to/playwright.config.ts`.

### CLI_PLAYWRIGHT_UNSUPPORTED_VERSION

**Warning.** The installed `@playwright/test` is older than the lowest supported version. The run
continues, but may not work. Update `@playwright/test`.

### CLI_REPORTER_PATH_UNSUPPORTED

**Error.** `--reporter` was passed and the package reporter must be appended to it, but the
package path contains a comma, which Playwright treats as a separator. Remove `--reporter` from
the command (then `withPerf()` adds the reporter itself) or move the project to a path without a
comma.

### CLI_SPAWN_FAILED

**Error.** The Playwright process could not be started. The message contains the system error.
Check that Node can run the Playwright CLI of the project; reinstalling the dependencies usually
helps.

### CLI_OUTCOME_MISSING

**Error (exit code 3).** Playwright finished, but the package reporter wrote no outcome file, so
the result is unknown. The message gives Playwright's own exit code. Common causes:

- `playwright.config` does not use `withPerf()` (set it up with `npx pw-perf init`);
- a configuration error, printed above this message;
- no test matched the filters, so the reporter had nothing to do;
- Playwright stopped before the reporters finished, for example after a crash.

### CLI_OUTCOME_INVALID

**Error (exit code 3).** The outcome file exists but cannot be read or does not belong to this
run. This usually means two different versions of the package are installed (for example in a
monorepo). Make sure the project resolves a single version and run again.

### CLI_REPORT_NOT_FOUND

**Error.** The run report for `pw-perf report` or `pw-perf thresholds --from` does not exist. By
default the commands look for `report.json` in `report.dir` (`perf-results/`). Pass the file with
`--input` (report) or `--from` (thresholds), or run `npx pw-perf test` first.

### CLI_REPORT_TESTS_FAILED

**Warning.** The report given to `thresholds --from` comes from a run whose tests did not all pass.
Thresholds are derived anyway. Review the diff before you commit the files.

### CLI_CONFIG_DIR_MISSING

**Warning.** A command that runs no tests did not load a package config file and the config
directory recorded in the report does not exist on this machine (or the report has none).
Relative paths such as `thresholds.dir` and `report.dir` are resolved against the current
directory instead. Run the command from the directory of `playwright.config`, or pass the
package config with `--config`.

### CLI_WRITE_FAILED

**Error (exit code 3).** `thresholds --from` could not write a thresholds file, or `report` could
not write the HTML file. Check that the directory is writable, or pass another `--output`.

### CLI_INTERNAL_ERROR

**Error (exit code 3).** An unexpected error in the CLI. This is a bug in the package; please
open an issue with the full message.

## init

### INIT_NO_PLAYWRIGHT_CONFIG

**Error (exit code 3).** `pw-perf init` found no `playwright.config.*` in the current directory.
Run it in the directory of `playwright.config`; in a monorepo, in the package with the Playwright
tests.

### INIT_PLAYWRIGHT_TOO_OLD

**Error (exit code 3).** The project's `@playwright/test` is older than the lowest supported
version. Update it, then run `init` again.

### INIT_NO_TAGGED_TESTS

**Warning.** No test is tagged `@perf`, so the wizard proposes to measure all tests. To measure a
subset, tag tests with `test('title @perf', ...)` or `test('title', { tag: '@perf' }, ...)` and
choose `@perf`; see [adoption.md](adoption.md).

### INIT_MANUAL_STEP

**Info.** The wizard left a file unchanged because it did not recognize its layout or the file
already exists with other content: a config with another wrapper, several test objects or
`mergeTests()`, an existing script or CI file, a GitLab main file that must include the new job,
or a project that uses pnpm or yarn instead of npm. The hint shows the exact change to make by
hand. [adoption.md](adoption.md) lists the layouts `init` changes by itself.

### INIT_WRITE_FAILED

**Error (exit code 3).** A file could not be written while applying the changes. Check the
permissions of the file and its directory, then run `init` again.

## Collector and custom measurements

Collector problems never change a test result. Diagnostics travel with the samples and appear as
warnings in the report.

### COLLECTOR_CONTEXT_AUTO_TRACKED

**Info.** The browser context of the `page` fixture was not created through the package's
`context` fixture (for example a custom `context` or `page` fixture built on
`browser.newContext()`, or a `context` override applied after `withPerfFixtures()`), so the
`page` override started tracking it. Measurement works. To track it directly, apply
`withPerfFixtures()` last in the `extend` chain and build custom `context` fixtures on the base
`context`; see [adoption.md](adoption.md).

### COLLECTOR_LISTENER_ERROR

**Warning.** An internal handler of the collector failed (attaching to a context, handling a
request event, or draining a context at test end); the event or context was skipped. This is a
bug in the package; please report it with the message.

### COLLECTOR_TIMING_FAILED

**Warning.** Reading the timing or response of a finished request failed, so its sample was
skipped. This is a bug in the package or in the browser protocol; please report it.

### COLLECTOR_SAMPLE_LIMIT_REACHED

**Warning.** A single test made more than 20 000 measured requests; the samples above the limit
were dropped (the message gives the number). Split the test, or skip requests that do not need
measuring with `measure.exclude`.

### COLLECTOR_ATTACH_FAILED

**Error line on stderr.** The samples attachment could not be added to the test result, so the
samples of that test are lost; the reporter then counts it in
[`TESTS_NOT_INSTRUMENTED`](#tests_not_instrumented). The test result itself is not changed.
Report it if it repeats.

### COLLECTOR_REQUESTS_PENDING

**Warning.** Requests were still in flight when a test ended, even after waiting up to
`measure.pendingTimeoutMs`; they are recorded as `PENDING` and the message lists the keys with
the most of them. Typical sources are long polling, streaming responses and server-sent events.
Exclude such URLs with `measure.exclude` (this also removes the wait at test end), or raise
`measure.pendingTimeoutMs` for slow but finite requests.

### CUSTOM_INVALID_NAME

**Test error.** `perf.measure()`, `perf.start()` or `perf.end()` got an invalid name and threw a
`TypeError`. A name has 1 to 200 characters, no control characters and no leading or trailing
whitespace, for example `"checkout:load-cart"`.

### CUSTOM_ALREADY_STARTED

**Warning.** `perf.start(name)` was called while a measurement with the same name was still
running. The earlier one is recorded as `unfinished`. Call `perf.end(name)` before starting it
again, or use `perf.measure(name, fn)`.

### CUSTOM_END_WITHOUT_START

**Warning.** `perf.end(name)` was called without a matching `perf.start(name)` in the same test.
Check the name, and that `start` ran (for example it was not skipped by an early return).

### CUSTOM_UNFINISHED

**Warning.** Custom measurements were still running when the test ended (the message lists their
names). They are recorded with the outcome `unfinished`, which counts as an error of that
measurement. End every `perf.start()` with `perf.end()`, or use `perf.measure()`, which always
ends.

## Endpoint keys

### NORMALIZE_KEY_BUILDER_THREW

**Warning.** The custom `keys.keyBuilder` function threw an exception for a request; the built-in
normalization was used for it. Fix the function so it never throws; return `undefined` to use the
built-in rules.

### NORMALIZE_KEY_BUILDER_INVALID

**Warning.** `keys.keyBuilder` returned something other than a non-empty string or `undefined`;
the built-in normalization was used. Return the whole key as a string, or `undefined`.

### NORMALIZE_UNSUPPORTED_URL

**Warning.** A request URL could not be parsed or does not use `http`/`https`; the sample was
skipped. Usually harmless.

### NORMALIZE_KEY_TRUNCATED

**Warning.** An endpoint key was longer than 2000 characters, so it was shortened and ended with
a hash. Long keys usually contain ids or data that the built-in patterns do not recognize;
replace them with `keys.extraIdPatterns` or a `keys.keyBuilder` function.

### NORMALIZE_HIGH_CARDINALITY

**Warning.** Ten or more keys differ only in one path segment (for example `/users/alice`,
`/users/bob`, ...), which usually means test data in the URL. Each such key gets few samples and
cannot be evaluated well. Replace the segment with `keys.extraIdPatterns` or a `keys.keyBuilder`
function. See also [faq.md](faq.md).

### NORMALIZE_TOO_MANY_KEYS

**Warning.** The run has more than 1000 endpoint keys. Check the keys in the report for test data
and normalize it with `keys.extraIdPatterns`, `keys.dropQueryParams` or `keys.keyBuilder`.

## Statistics

### STATS_SAMPLES_WITHOUT_BROWSER_TIMING

**Warning.** Some successful samples had no timing from the browser (time source `node`) and were
left out of the time statistics; they still count in the number of requests and the statuses.
Usually only a few requests are affected and no action is needed.

### STATS_SAMPLES_OUTSIDE_MEASURED_PROJECTS

**Warning.** Samples came from projects that are not measured (the message names them) and were
not aggregated. Setup and teardown projects run once and are not measured; move the calls you
want to measure into tests of a measured project, or adjust `run.projects`.

### STATS_MULTIPLE_BROWSERS

**Warning.** Request samples come from more than one browser, so timings of different engines are
mixed in the same keys. Measure one browser engine per run with `run.projects`.

## Run and reporter

### RUN_INCOMPLETE

**Tool error (exit code 3).** The run did not execute all tests: it timed out, was interrupted,
or stopped after `maxFailures` failures. The evaluation covers only the samples collected, and a
thresholds run writes no files. Measure a smaller subset of tests, or make sure no timeout or
failure limit stops the run (perf mode sets Playwright's own `globalTimeout` and `maxFailures` to
0; a CI job time limit can still stop it).

### RUN_SHARDED

**Tool error (exit code 3).** The perf-mode run was started with `--shard`. Each shard would
evaluate only part of the keys with only part of the samples. Run perf mode on one machine
without sharding. (The CLI refuses `--shard` already; this code appears in manual mode.)

### RUN_CONDITIONS_CHANGED

**Warning.** The run did not use the conditions perf mode sets: more than one worker, retries, a
different number of repetitions, retried results, or trace/video recorded. Common causes are
`--workers`, `--retries` or `--repeat-each` on the command line, another config wrapper applied
after `withPerf()`, and `test.describe.configure({ retries })` or `test.use({ trace, video })` in
test files, which override the config. Remove them for perf runs; set repetitions with
`run.repeat` or `--repeat`. See [adoption.md](adoption.md).

### TESTS_FAILED

**Warning.** Some test executions failed, but no more than `gate.maxFailedTestShare` (10% by
default). Their samples are still used and the performance result decides the exit code.
Functional failures are reported by your regular test run; a test that fails only in perf mode
may be affected by the repetitions (for example tests that create the same data).

### TESTS_FAILED_TOO_MANY

**Tool error (exit code 3).** More test executions failed than `gate.maxFailedTestShare` allows,
so samples of a large part of the tests are missing and the result is not trustworthy. Fix the
failing tests (run them without perf mode first), or raise `gate.maxFailedTestShare` if the
failures are expected.

### TESTS_NOT_INSTRUMENTED

**Warning.** Tests of measured projects finished without the samples attachment, so they were
not measured. The test files import `test` from `@playwright/test` (or another test object) that
was not wrapped with `withPerfFixtures()`. Import `test` from a wrapped test object or from
`playwright-performance-regression/test`; see [adoption.md](adoption.md). A crashed worker also
loses the attachment.

### ATTACHMENT_DUPLICATE

**Warning.** A test result had more than one samples attachment; all of them were processed. This
happens when two separately wrapped test objects are merged, or the fixtures are added twice in
another way. Apply `withPerfFixtures()` once, to the final test object.

### REPORT_WRITE_FAILED

**Tool error (exit code 3).** `report.json` could not be written to `report.dir`. Check that the
directory is writable and the disk is not full.

### OUTCOME_WRITE_FAILED

**Error line on stderr.** The reporter could not write the outcome file that tells the CLI the
result; the CLI then ends with [`CLI_OUTCOME_MISSING`](#cli_outcome_missing). Check that the
temporary directory is writable.

### REPORTER_INTERNAL_ERROR

**Tool error (exit code 3).** An unexpected error in the package reporter. This is a bug in the
package; please open an issue with the full message.

## Evaluation

### EVAL_NO_SAMPLES

**Warning.** The run recorded no samples, so nothing was evaluated. Tests must use the fixtures of
a test object wrapped with `withPerfFixtures()`, and the `measure` options (`include`, `exclude`,
`resourceTypes`) must not filter out every request. See also
[`TESTS_NOT_INSTRUMENTED`](#tests_not_instrumented).

### EVAL_PERCENTILE_MISMATCH

**Warning.** The thresholds file was derived for another percentile (`evaluatedPercentile`) than
`checks.time.percentile.level` now evaluates; the file's limits are compared with the new
percentile. Derive the thresholds again after changing the level.

### THRESHOLDS_FILE_MISSING

**Warning.** The thresholds file for a kind (endpoints or custom measurements) and the current
environment label was not found, so those keys are evaluated with the default limits from
`checks.*.limit`. Derive thresholds with `npx pw-perf thresholds` and commit the file. When an
environment label is set, a file without the label is not used for it; the hint says so when such
a file exists. See [thresholds.md](thresholds.md).

### THRESHOLDS_FILE_OUTDATED

**Warning.** The thresholds file has an older format version and was migrated while reading. The
next `pw-perf thresholds` run writes it in the current format and keeps locked entries.

### THRESHOLDS_UNSEEN_ENTRIES

**Warning.** Entries in a thresholds file belong to keys that did not appear in this run. Either
the run covered only part of the tests (a filter), or the endpoints are gone. Run the full
measurement set, or remove stale entries with `npx pw-perf thresholds --prune`.

### THRESHOLDS_ENTRIES_NOT_EVALUATED

**Warning.** Keys with an entry in the thresholds file had fewer samples than the rules need
(`minSamples`), so they were not evaluated. Run more repetitions (`run.repeat.test` or
`--repeat`), or accept that the endpoint is called rarely. See the sample arithmetic in
[adoption.md](adoption.md).

### THRESHOLDS_ENV_MISMATCH

**Warning.** The environment label recorded in a thresholds file does not match the label of the
run. When evaluating, the file was probably copied or renamed by hand; when deriving (thresholds
mode or `--from`), the source report was recorded for another environment than the files are
written for. Check `--env` and `run.env`, and derive thresholds for each environment separately.

### THRESHOLDS_SOURCE_MISMATCH

**Warning.** A thresholds file was derived under other conditions than the current run (or the
source report): another browser, Playwright version (major.minor), machine or normalization
rules. Timings from another machine or browser are not comparable: derive thresholds on the same
infrastructure that runs the gate, usually CI (see [thresholds.md](thresholds.md)). After a change
of normalization, derive again so the keys match.

### THRESHOLDS_MUTED

**Warning.** Some keys are muted in the thresholds file (`gate: "warn"` with `until`), so their
violations are reported but do not block. Remove `gate` and `until` from the entry once the cause
is fixed.

### THRESHOLDS_MUTE_EXPIRING

**Warning.** The muting of some keys ends within 7 days. Fix the cause before the end date, or
extend `until` on purpose.

### THRESHOLDS_MUTE_EXPIRED

**Warning.** The `until` date of a muting has passed, so the key blocks again. Remove `gate` and
`until` from the entry, or extend `until` on purpose.

## Thresholds derivation

These codes come from `pw-perf thresholds` and `pw-perf thresholds --from`. A refusal is a tool
error (exit code 3) and writes no thresholds file.

### THRESHOLDS_SOURCE_INCOMPLETE

**Tool error (exit code 3).** The source run was interrupted or timed out, or it has tool errors
(the message lists their codes), so it is not a trustworthy base; no file was written. Fix the
cause and derive again from a complete run.

### THRESHOLDS_EMPTY_REPORT

**Tool error (exit code 3).** The source report has no samples at all; no file was written. The
tests are probably not measured: check the integration as for
[`EVAL_NO_SAMPLES`](#eval_no_samples).

### THRESHOLDS_NOTHING_TO_DERIVE

**Tool error (exit code 3).** No key has enough successful samples for an entry (at least
`checks.time.median.minSamples`); no file was written. Run more repetitions
(`run.repeat.thresholds` or `--repeat`).

### THRESHOLDS_KIND_SKIPPED

**Warning.** One kind (endpoints or custom measurements) has no key with enough samples, so its
file was not written; the other kind was. Run more repetitions if you need that file.

### THRESHOLDS_MANUAL_FILE

**Warning.** An existing thresholds file was written by hand (`generated: null`). Its complete
entries that are not locked are recomputed. Mark entries you want to keep as they are with
`"locked": true`.

### THRESHOLDS_SOURCE_TESTS_FAILED

**Warning.** The source report has failed test executions; their samples may raise the
thresholds. Review the diff before committing, or fix the tests and derive again.

### THRESHOLDS_SOURCE_TEST_MODE

**Warning.** The report given to `--from` comes from a `test` run, which usually has fewer
repetitions than a `thresholds` run. Prefer a report of `pw-perf thresholds` as the source.

### THRESHOLDS_LOOSENED_MUCH

**Warning.** Some time limits grew by more than `thresholds.loosenWarnRelative` (50% by default)
in this derivation; these entries are marked with `!` in the diff. Check that the new limits do
not accept a regression before you commit them.

### THRESHOLDS_WRITE_FAILED

**Tool error (exit code 3).** A thresholds file could not be written in a thresholds run. Check
that `thresholds.dir` is writable, then derive again (or use `--from` with the report of this
run).

### THRESHOLDS_DIFF_WRITE_FAILED

**Warning.** The thresholds files were written, but `thresholds-diff.md` could not be written to
`report.dir`. Check that the directory is writable; the diff is also printed in the console.

## Files and schemas

These codes describe a file the package reads: a thresholds file, a run report, a samples
attachment or the outcome file. An invalid thresholds file is a tool error (exit code 3); the
keys of its kind are not evaluated and never fall back to default limits. An unreadable samples
attachment is skipped with a tool error.

### SCHEMA_INVALID_JSON

**Error.** The file is not valid JSON, or cannot be read at all (the message gives the reason).
Fix the JSON syntax (for example after a merge conflict), or delete a generated file and let the
package write it again.

### SCHEMA_VERSION_MISSING

**Error.** The file has no `schemaVersion`. Add it at the top level, or let the package write the
file again.

### SCHEMA_VERSION_TOO_NEW

**Error.** The file was written by a newer version of the package than the one installed. Update
the package (all machines and CI should use the same version).

### SCHEMA_VERSION_MISMATCH

**Error.** A samples attachment has another format version than the reporter expects, so the
fixtures and the reporter come from different package versions. Make sure the project uses one
version of the package.

### SCHEMA_VALIDATION_FAILED

**Error.** The file is valid JSON but does not match its format; the message lists up to five
fields with the problem. Fix the listed fields; the JSON Schemas in the package's `schemas/`
directory describe each format. Hand edits of thresholds files are the usual cause.

### THRESHOLDS_KIND_MISMATCH

**Error.** A thresholds file has a `kind` that does not match its file name: endpoint limits live
in `perf-thresholds.api[.<env>].json`, custom measurements in
`perf-thresholds.custom[.<env>].json`. Move the entries to the right file or fix `kind`.

## HTML report

### HTML_RENDER_FAILED

**Tool error (exit code 3).** The HTML report could not be rendered. `report.json` is complete
and records the error. This is a bug in the package; please report it with the message.

### HTML_WRITE_FAILED

**Tool error (exit code 3).** `report.html` could not be written to `report.dir`; `report.json`
is kept. Check that the directory is writable; `npx pw-perf report` renders the page again from
`report.json`.
