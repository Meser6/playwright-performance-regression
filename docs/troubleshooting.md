# Troubleshooting

Every problem the package reports carries a code in capital letters, such as
`THRESHOLDS_FILE_MISSING`. This page has one section per code: what it means, what usually causes
it and how to fix it. Search the page for the code you see.

## Where codes appear

- **Console summary** at the end of a perf-mode run (after a separator line): tool errors under
  `Errors:` (marked `✖`, red), then up to 10 warnings under `Warnings:` (marked `!`, yellow), each
  as `CODE: message` with an indented `Hint:` line. The verdict at the end names the cause of an
  `ERROR`, e.g. `too many failed tests (30 of 101 executions)`.
- **`pw-perf-results/report.json`**: the arrays `toolErrors` and `warnings` hold every issue of the
  run with its code, message and hint.
- **`pw-perf-results/report.html`**: the same warnings and tool errors near the top of the page.
- **Setup output (stderr)**: errors of the guided setup (`INIT_*`) and of the `pw-perf` binary
  that starts it (`CLI_*`).
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
- [Setup command](#setup-command)
- [init](#init)
- [Collector](#collector)
- [Endpoint keys](#endpoint-keys)
- [Step keys](#step-keys)
- [Statistics](#statistics)
- [Run and reporter](#run-and-reporter)
- [Evaluation](#evaluation)
- [Thresholds derivation](#thresholds-derivation)
- [Files and schemas](#files-and-schemas)
- [HTML report](#html-report)

## Configuration and perf mode

Configuration errors are collected and reported together, each with the option path. Inside a
test run they stop Playwright while it loads the config, so no `outcome.json` is written; read the
list printed above Playwright's error.

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
`p50`, a rule with a smaller `minSamples` than the median rule, every rule disabled, a
`thresholds.preset` other than `strict`, `normal` or `loose`, a `PW_PERF_ENV` or `PW_PERF_PASSES` value out of
range, or the environment label `steps` or `requests`, which are parts of the thresholds file
names (`pw-perf-thresholds.steps.json`). The message names the option and the value received.

### CONFIG_BASEURL_EMPTY

**Warning.** `use.baseURL` of a measured project is empty, or its host contains `undefined` or
`null` (for example `https://undefined.example.com`, the result of an unset environment
variable). The tests probably run against the wrong address. If `baseURL` comes from environment
variables, run the tests through the script that sets them, e.g. `PW_PERF_MODE=test npm run
e2e:qa`.

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

### CONFIG_NO_MEASURED_PROJECT

**Error.** No project is measured: the test command runs only setup or teardown projects
(projects named in `dependencies` or `teardown` of another project), for example
`--project setup`. Select the projects with the tests to measure instead; their setup projects
run with them. Without `--project` every project that is not a setup or teardown project is
measured.

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
`playwright-performance-regression/config`, or run `npm init playwright-performance-regression`.

### MODE_INVALID_VALUE

**Error.** A `PW_PERF_*` environment variable has an invalid value: `PW_PERF_MODE` other than
`test`, `thresholds` or `check`, `PW_PERF_PASSES` that is not a positive integer, `PW_PERF_PASS`
that is not `k/N` with 2 ≤ k ≤ N (the package sets it for passes 2 to N), `PW_PERF_ENV` that is
not a valid environment label, `PW_PERF_MAX_TESTS` outside 1–1000, `PW_PERF_PRUNE`
other than `1`, or, in the guided setup, `PW_PERF_DRY_RUN` or `PW_PERF_NO_TUTORIAL`
other than `1` and `PW_PERF_LANG` that is not one of `en`, `es`, `fr`, `pl`, `it`, `uk`, `ru`
(the setup then stops with exit code 3 before its first question). `PW_PERF_REPEAT` was renamed to `PW_PERF_PASSES`: a set
`PW_PERF_REPEAT` is an error with that hint. An invalid value never silently turns perf mode off. Fix or unset the variable,
e.g. `PW_PERF_MODE=test npm run e2e` (see [cli.md](cli.md)).

## Setup command

The package has no commands or options of its own. `npm init playwright-performance-regression`
(or `npx pw-perf` in a project with the package installed) starts the guided setup; measurement
runs are your own test command with the `PW_PERF_*` variables (see [Running](cli.md)).

### CLI_UNKNOWN_COMMAND

**Error (exit code 3).** The `pw-perf` binary or the create package got arguments, e.g.
`npx pw-perf test` or `npm init playwright-performance-regression -- --yes`. They take none: run
your test command with `PW_PERF_MODE=test` (or `thresholds`, `check`), and control the setup with
`PW_PERF_LANG=<code>`, `PW_PERF_DRY_RUN=1` and `PW_PERF_NO_TUTORIAL=1` (see [Running](cli.md)).
The help is printed after the error.

### CLI_INTERNAL_ERROR

**Error (exit code 3).** An unexpected error in the setup command. This is a bug in the package;
please open an issue with the full message.

## init

### INIT_NO_PLAYWRIGHT_CONFIG

**Error (exit code 3).** The guided setup found no `playwright.config.*` in the current directory.
Run it in the directory of `playwright.config`; in a monorepo, in the package with the Playwright
tests.

### INIT_PLAYWRIGHT_TOO_OLD

**Error (exit code 3).** The project's `@playwright/test` is older than the lowest supported
version. Update it, then run `init` again.

### INIT_NO_TAGGED_TESTS

**Info.** No test is tagged `@perf` yet. The wizard measures all tests by default either way. To
measure a subset, tag tests with `test('title', { tag: '@perf' }, ...)` and choose `@perf`; see
[adoption.md](adoption.md).

### INIT_MANUAL_STEP

**Info.** The wizard left a file unchanged because it did not recognize its layout or the file
already exists with other content: a config with another wrapper, several test objects or
`mergeTests()`, an existing script or CI file, a GitLab main file that must include the new job,
or a project that uses pnpm or yarn instead of npm. The hint shows the exact change to make by
hand. [adoption.md](adoption.md) lists the layouts `init` changes by itself.

### INIT_TEST_OBJECT_MANUAL

**Warning.** Nothing is measured yet: the wizard found no fixtures module it could wrap without
touching your test files, so it changed none and showed a red box with the code to paste. Either
wrap the `test` exported by your fixtures file — `export const test =
withPerfFixtures(base.extend({ ... }))` with `withPerfFixtures` from
`playwright-performance-regression/fixture` — or import `test` and `expect` from
`playwright-performance-regression/test` instead of `@playwright/test` in your test files.
[adoption.md](adoption.md) covers `mergeTests`, several test objects and playwright-bdd.

### INIT_SCRIPT_FLAG

**Warning.** The test script you chose has flags that break a measurement run (`--ui`, `--debug`,
`--shard`, `--reporter`, `--last-failed`, `--only-changed`, `--workers`, `--repeat-each`,
`--max-failures`, `-x`, `--global-timeout`). The script is not changed: add a script without them,
e.g. `e2e:perf`, and choose it when you run `init` again.

### INIT_SCRIPT_LATER_STEPS

**Warning.** The chosen script runs more steps after Playwright (e.g. uploading a report); they
also run in measurement runs when Playwright exits with 0. If they should not, add a script
without them.

### INIT_WRITE_FAILED

**Error (exit code 3).** A file could not be written while applying the changes. Check the
permissions of the file and its directory, then run `init` again.

## Collector

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

## Endpoint keys

### NORMALIZE_KEY_BUILDER_THREW

**Warning.** Your `keys.keyBuilder` function threw an exception for a request; the built-in
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

## Step keys

See [steps.md](steps.md) for the step timings.

### No test.step blocks found

Not a warning: the measured tests gave no step sample, so there is no step thresholds file. When
your tests or page objects do use `test.step`, check that `measure.steps.include`, `exclude` and
`categories` do not filter out every step.

### STEPS_HIGH_CARDINALITY

**Warning.** Ten or more step keys differ only in one word, which usually means test data in the
step titles (for example `Open report alpha`, `Open report bravo`, ...). Keep the value out of
the title, add a pattern to `keys.extraIdPatterns` or exclude the step with
`measure.steps.exclude`. When the word is in quotes, `measure.steps.redactQuotedValues: true`
replaces quoted values with `:value`.

### STEPS_TOO_MANY_KEYS

**Warning.** The run has more than 1000 step keys. Keep `measure.steps.categories` at
`["test.step"]` or lower `measure.steps.maxDepth`.

### STEPS_SECRET_REDACTED

**Warning.** One or more step titles contained a URL or a secret (a JWT, an authentication scheme
such as `Bearer`, or a pair like `password=...`). The keys show placeholders, and the warning lists
the rules and up to five `file:line` locations, never the titles. The data still reaches
Playwright's own reports and traces, so remove it from the step title.

## Statistics

### STATS_SAMPLES_WITHOUT_BROWSER_TIMING

**Warning.** Some successful samples had no timing from the browser (time source `node`) and were
left out of the time statistics; they still count in the number of requests and the statuses.
Usually only a few requests are affected and no action is needed.

### STATS_SAMPLES_OUTSIDE_MEASURED_PROJECTS

**Warning.** Samples came from projects that are not measured (the message names them) and were
not aggregated. Setup and teardown projects run once and are not measured; move the calls you
want to measure into tests of a measured project.

### STATS_MULTIPLE_BROWSERS

**Warning.** Request samples come from more than one browser, so timings of different engines are
mixed in the same keys. Measure one browser engine per run: select its projects with `--project`
in the measurement command, e.g. `--project chromium`.

## Run and reporter

### CHECK_RANDOM_HOST

**Warning, `check` only.** Some origins look generated per environment (a host label with three or
more digits, a random mix of letters and digits, a UUID). Their keys, or the normalization
fingerprint when it is the `baseURL` origin, would change on every CI instance. The hint contains a
ready `keys.origins` object with host patterns; see [dynamic-environments.md](dynamic-environments.md).
A wrong guess only costs this line.

### RUN_PROJECT_NO_REQUESTS

**Warning.** A measured project ran tests with the pw-perf fixtures, but no request of the
browser was recorded in it. Tests that only use the `request` fixture (API tests) are not
measured: requests made outside the browser are out of scope, so leave such projects out of the
measurement command (`--project`). Otherwise check `use.baseURL`, that the tests import the test object wrapped with
`withPerfFixtures()`, and `measure.include` / `measure.exclude`.

### RUN_REPORTER_FLAG

**Warning, on stderr only.** The test command has a `--reporter` option (also one written in an npm
script) that does not include the pw-perf reporter. `--reporter` replaces every reporter of the
config, so the run is measured but nothing is evaluated and no report is written. Remove
`--reporter` from the measurement command, or add the reporter to it:
`--reporter=line,playwright-performance-regression/reporter`.

### RUN_UNSUPPORTED_FLAG

**Warning.** The test command has `--ui`, `--ui-host`, `--ui-port` or `--debug`. Interactive runs
are not measured reliably. Use a separate script without these options for the measurement.

### RUN_PRUNE_SKIPPED

**Warning.** `PW_PERF_PRUNE=1` was set in a thresholds run that selects only some tests (`--grep`,
`--project`, file filters and similar). Removing the entries not seen in the run would delete the
thresholds of the other tests, so the files were written without removing anything. Prune in a
run of all tests.

### RUN_INCOMPLETE

**Tool error (exit code 3).** The run did not execute all tests: it timed out, was interrupted,
or stopped after `maxFailures` failures. The evaluation covers only the samples collected, and a
thresholds run writes no files. Measure a smaller subset of tests, or make sure no timeout or
failure limit stops the run (perf mode sets Playwright's own `globalTimeout` and `maxFailures` to
0; a CI job time limit can still stop it).

### RUN_SHARDED

**Tool error (exit code 3).** The perf-mode run was started with `--shard`. Each shard would
evaluate only part of the keys with only part of the samples. Run perf mode on one machine
without sharding.

### RUN_CONDITIONS_CHANGED

**Warning.** The run did not use the conditions perf mode sets: more than one worker, a
`repeatEach` other than 1, or trace/video recorded. Common causes are `--workers` or
`--repeat-each` on the command line, another config wrapper applied after `withPerf()`, and
`test.use({ trace, video })` in test files, which override the config. Remove them for perf runs;
set the number of passes with `run.passes` or `PW_PERF_PASSES`. Retries are no deviation: the
`retries` of your config apply and every attempt is measured. See [adoption.md](adoption.md).

### RUN_PASS_FAILED

**Warning.** A pass after the first one ended without writing its `pw-perf-results/pass-<k>.json`,
or wrote one of another run. The usual cause is a step of the test script before Playwright that
failed in that pass (seeding data, starting a service); the output of that pass is above the
warning. The other passes are evaluated; the report shows the pass under "Passes". See
[cli.md](cli.md#passes).

### RUN_PASS_INTERRUPTED

**Tool error (exit code 3).** The process of a pass ended by a signal (or with exit code 130 or
143), so the following passes did not start. The evaluation of the completed passes is in the
report, but the result is incomplete. Run the measurement again.

### RUN_PASS_SPAWN_FAILED

**Tool error (exit code 3).** The next pass could not be started, for example because the package
manager of the script is no longer on the path. The message shows the command. Check that the test
command runs on its own, or set `run.passes` to 1.

### RUN_REPORT_DIR_NOT_CLEANED

**Warning.** Every `test` and `thresholds` run empties `report.dir` (default `pw-perf-results/`)
when its first test starts, so old reports never mix with new ones. The folder was left as it is
because it does not look like a results folder: it is the project directory, the directory of
`playwright.config`, the home directory, the filesystem root, `thresholds.dir` or a folder that
contains one of them, or it holds a thresholds file, `package.json`, `playwright.config.*`, `.git`
or more than 10000 entries. Set `report.dir` to a folder used only for the results, e.g.
`pw-perf-results`. The same warning with the error text means a file could not be removed;
check that the folder is writable. The run itself is not affected.

### TESTS_FAILED

**Warning.** Some test executions failed, but no more than `gate.maxFailedTestShare` (10% by
default). Their samples are counted, including those recorded before a test failed, and the
performance result decides the exit code. A test that fails early records fewer samples, so fix
the failing tests in your regular test run; a test that fails only in perf mode
may be affected by the repetitions (for example tests that create the same data).

### TESTS_FAILED_TOO_MANY

**Tool error (exit code 3).** More test executions failed than `gate.maxFailedTestShare` allows,
so samples of a large part of the tests are missing and the result is not trustworthy. The
summary ends with `✖ ERROR  too many failed tests (F of N executions)` and `outcome.json` has
`exitCode` 3. Fix the
failing tests (run them without perf mode first), or raise `gate.maxFailedTestShare` if the
failures are expected.

### TESTS_NOT_INSTRUMENTED

**Warning.** Tests of measured projects finished without the samples attachment, so they were
not measured. The message counts tests (not repetitions) and names up to three files, e.g.
`2 tests in tests/api.spec.ts import test without withPerfFixtures() (e.g. straight from
@playwright/test), so they were not measured.` Import `test` from a wrapped test object or from
`playwright-performance-regression/test`; see [adoption.md](adoption.md). When a worker process
crashed, the message also says which tests lost their measurement that way. The warning is shown in
every mode, also when deriving thresholds: these tests get no thresholds.

### ATTACHMENT_DUPLICATE

**Warning.** A test result had more than one samples attachment; all of them were processed. This
happens when two separately wrapped test objects are merged, or the fixtures are added twice in
another way. Apply `withPerfFixtures()` once, to the final test object.

### REPORT_WRITE_FAILED

**Tool error (exit code 3).** `report.json` could not be written to `report.dir`. Check that the
directory is writable and the disk is not full.

### OUTCOME_WRITE_FAILED

**Error line on stderr.** The reporter could not write the outcome file (`outcome.json` in
`report.dir`), so the exact result is missing. Check that the directory is writable.

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

**Warning.** The thresholds file for a kind (endpoints) and the current environment label was not
found, so those keys are evaluated with the default limits from `checks.*.limit`. It is reported
only in test mode and only for a kind that has keys in the run; the thresholds run that writes
the file does not report it. Derive thresholds with `PW_PERF_MODE=thresholds npm run e2e` and commit the file. When an
environment label is set, a file without the label is not used for it; the hint says so when such
a file exists. See [thresholds.md](thresholds.md).

### THRESHOLDS_FILE_OUTDATED

**Warning.** The thresholds file has an older format version and was migrated while reading. The
next thresholds run (`PW_PERF_MODE=thresholds`) writes it in the current format and keeps locked entries.

### THRESHOLDS_UNSEEN_ENTRIES

**Warning.** Entries in a thresholds file belong to keys that did not appear in this run. Either
the run covered only part of the tests (a filter), or the endpoints are gone. Run the full
measurement set, or remove stale entries with `PW_PERF_PRUNE=1 PW_PERF_MODE=thresholds npm run e2e`.

### THRESHOLDS_ENTRIES_NOT_EVALUATED

**Warning.** Keys with an entry in the thresholds file had fewer samples than the rules need
(`minSamples`), so they were not evaluated. Run more passes (`run.passes.test` or
`PW_PERF_PASSES`), or accept that the endpoint is called rarely. See the sample arithmetic in
[adoption.md](adoption.md).

### THRESHOLDS_ENV_MISMATCH

**Warning.** The environment label recorded in a thresholds file does not match the label of the
run. When evaluating, the file was probably copied or renamed by hand; when deriving (thresholds
mode), the source report was recorded for another environment than the files are
written for. Check `PW_PERF_ENV` and `run.env`, and derive thresholds for each environment separately.

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

These codes come from thresholds runs (`PW_PERF_MODE=thresholds`). A refusal is a tool
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
`checks.time.median.minSamples`); no file was written. Run more passes
(`run.passes.thresholds` or `PW_PERF_PASSES`).

### THRESHOLDS_KIND_SKIPPED

**Warning.** One kind of keys has no key with enough samples, so its file was not written; the
files of the other kinds were. Run more repetitions if you need that file.

### THRESHOLDS_MANUAL_FILE

**Warning.** An existing thresholds file was written by hand (`generated: null`). Its complete
entries that are not locked are recomputed. Mark entries you want to keep as they are with
`"locked": true`.

### THRESHOLDS_SOURCE_TESTS_FAILED

**Warning.** The source report has failed test executions; their samples may raise the
thresholds. Review the diff before committing, or fix the tests and derive again.

### THRESHOLDS_SOURCE_TEST_MODE

**Warning.** The source report comes from a `test` run, which usually has fewer passes than a
`thresholds` run. Prefer a thresholds run (`PW_PERF_MODE=thresholds`) as the source.

### THRESHOLDS_LOOSENED_MUCH

**Warning.** Some time limits grew by more than `thresholds.loosenWarnRelative` (50% by default)
in this derivation; these entries are marked with `!` in the diff. Check that the new limits do
not accept a regression before you commit them.

### THRESHOLDS_WRITE_FAILED

**Tool error (exit code 3).** A thresholds file could not be written in a thresholds run. Check
that `thresholds.dir` is writable, then derive again.

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
in `pw-perf-thresholds[.steps][.<env>].json`. Move the entries to the right file or fix `kind`.

## HTML report

### HTML_RENDER_FAILED

**Tool error (exit code 3).** The HTML report could not be rendered. `report.json` is complete
and records the error. This is a bug in the package; please report it with the message.

### HTML_WRITE_FAILED

**Tool error (exit code 3).** `report.html` could not be written to `report.dir`; `report.json`
is kept. Check that the directory is writable, then run again.
