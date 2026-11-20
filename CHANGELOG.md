# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Breaking: every file and directory the package creates now starts with `pw-perf`. The default
  thresholds files are `pw-perf-thresholds.<kind>[.<env>].json` (`thresholds.filePrefix`, was
  `perf-thresholds`) and the default output directory is `pw-perf-results/` (`report.dir`, was
  `perf-results`); the files inside keep their names. The samples attachment of each test is
  `pw-perf-samples` (was `playwright-performance-regression-samples`). Old names are not read: rename existing
  thresholds files and the `.gitignore` entry, or set the old values in the config.
- `init` no longer asks for the label of the `baseURL` origin: labels are automatic (no label for
  the `baseURL` origin, the host for other hosts), and the summary points to `keys.origins` for
  shorter labels. The steps are numbered 1 to 10.
- `init` measures all tests by default, also when some tests are tagged `@perf` and with `--yes`.
  `INIT_NO_TAGGED_TESTS` is now information shown in the wizard, not a warning.
- The `pw-perf.config.ts` written by `init` lists every option: the answers that differ from the
  defaults as code, all other options as comments with their default value and a one-line
  description, grouped by section. The comments are generated from the config schema.

## [0.1.0-next.1] - 2026-11-19

### Added

- `init` asks first whether to set the package up with a guided tutorial; no (or
  `--no-tutorial`) prints the manual setup steps and changes nothing.
- `init` speaks English, Spanish, French, Polish, Italian, Ukrainian and Russian: chosen in the
  first step or with `--lang <code>`. Codes, file names and the written files stay English.
- Colors in the terminal for `init` (step headers, questions, diffs, summary) and the CLI
  messages, run summary and thresholds diff, with `NO_COLOR`, `FORCE_COLOR` and `TERM=dumb`.

### Fixed

- The `init` hint and the docs show Playwright's tag option `{ tag: '@perf' }` for tagging tests.
- `bin` paths in both packages no longer start with `./`, so npm stops warning that it
  corrected them when publishing.
- README: `yarn create` with a version (such as `@next`) needs Yarn 2 or later.

## [0.1.0-next.0] - 2026-11-19

### Added

- Package manifest with the entry points `playwright-performance-regression`, `/config`,
  `/fixture`, `/test`, `/reporter` and the `playwright-performance-regression` and `pw-perf`
  commands.
- JSON Schemas for the configuration and all file formats, published under `schemas/`.
- Reading of the sample batch, run report, thresholds and outcome files with `schemaVersion`
  checks, migrations and error codes `SCHEMA_INVALID_JSON`, `SCHEMA_VERSION_MISSING`,
  `SCHEMA_VERSION_TOO_NEW`, `SCHEMA_VERSION_MISMATCH`, `SCHEMA_VALIDATION_FAILED` and
  `THRESHOLDS_KIND_MISMATCH`; a muting `until` date must exist in the calendar.
- Stable JSON output for every file the package writes: sorted keys, 2-space indent, final
  newline, atomic write.
- Run report assembly with rounding, fixed array order and raw URLs only with `report.rawUrls`;
  CI metadata for GitHub Actions, GitLab CI, Jenkins and Azure Pipelines.
- `definePerfConfig()` and `perfDefaults` in the package entry point. `perfDefaults` holds the
  resolved default config (frozen), for extending a default list such as
  `measure.exclude: [...perfDefaults.measure.exclude, 'intercom.io']`.
- Package config resolution: defaults from the `default` keywords of
  `schemas/config.schema.json`, objects merged and arrays replaced, `RegExp` or
  `{ regex, flags }` URL patterns (compiled without the `g` and `y` flags, so a pattern matches
  the same way on every call), environment overrides of `run.env` and `run.repeat`, and a
  JSON snapshot of the effective config for the run report.
- Config validation that reports all problems at once, with the option path, the value received,
  the expected format and, for a mistyped option, the closest known name: error codes
  `CONFIG_UNKNOWN_OPTION`, `CONFIG_INVALID_TYPE`, `CONFIG_INVALID_VALUE` and
  `CONFIG_INVALID_REGEX`; warnings `CONFIG_DUPLICATE_ORIGIN_LABEL`,
  `CONFIG_RESOURCE_TYPE_LONG_LIVED` and `CONFIG_PERCENTILE_IS_P99`.
- Endpoint keys from request URLs: origin labels, id patterns for numbers, UUIDs, hex strings,
  tokens, mixed-case ids and e-mail addresses (`:id`, `:email`), sorted query parameter names
  with optional kept values, deterministic truncation of long keys and a custom `keyBuilder`
  with fallback warnings `NORMALIZE_KEY_BUILDER_INVALID` and `NORMALIZE_KEY_BUILDER_THREW`.
- Normalization fingerprint of the key rules and warnings `NORMALIZE_HIGH_CARDINALITY` and
  `NORMALIZE_TOO_MANY_KEYS` for key explosion.
- Statistics per endpoint key and custom measurement: sample, success, error and per-status
  counts (cancelled requests are labeled `ABORTED` and are not errors by default), time sources,
  test counts, samples from failed tests, exact minimum, maximum and average, percentiles p50,
  p90, p95, p99 and the evaluated percentile (linear interpolation, as in spreadsheets and
  NumPy), TTFB, the 3 slowest samples with their start time and the 5 tests with the most
  samples. Above `advanced.maxSamplesPerKey` successful samples a seeded uniform sample is kept;
  the result does not depend on the order of the samples.
- Only samples of measured projects are aggregated; warnings
  `STATS_SAMPLES_OUTSIDE_MEASURED_PROJECTS`, `STATS_SAMPLES_WITHOUT_BROWSER_TIMING` and
  `STATS_MULTIPLE_BROWSERS`.
- Apdex and Wilson score interval functions used by the evaluation and thresholds.
- Evaluation of every endpoint key and custom measurement against the thresholds files: limits
  from the file entry, completed from the config for hand-written entries, or default
  thresholds; rules `median`, `percentile`, `p99`, `apdex` (upper bound of the 95% interval),
  `wilson` and `errors` (lower bound), each with its own minimum sample count; hard limit,
  tolerance in keys or percent, `gate.warnOnly` and `gate.defaultThresholds`; evaluation status
  `passed`, `warned`, `failed` or `error` and per-kind counters. An invalid thresholds file
  stops the evaluation of its kind only and never falls back to default thresholds.
- Muting of a key in the thresholds file (`gate: "warn"` with `note` and `until`): its
  violations never block until the end date; warnings `THRESHOLDS_MUTED`,
  `THRESHOLDS_MUTE_EXPIRING` (7 days before) and `THRESHOLDS_MUTE_EXPIRED`.
- Thresholds file warnings `THRESHOLDS_FILE_MISSING` (also naming a file without the
  environment label), `THRESHOLDS_FILE_OUTDATED`, `THRESHOLDS_UNSEEN_ENTRIES`,
  `THRESHOLDS_ENTRIES_NOT_EVALUATED`, `EVAL_PERCENTILE_MISMATCH`, `THRESHOLDS_ENV_MISMATCH`,
  `THRESHOLDS_SOURCE_MISMATCH` (other browser, Playwright minor version, machine or
  normalization) and `EVAL_NO_SAMPLES`.
- Exit code of a perf-mode run in the outcome file: 3 for tool errors, 2 for blocking
  violations in `test` mode, otherwise 0 (also with warnings and in `thresholds` mode). Failed
  tests are a warning `TESTS_FAILED` up to `gate.maxFailedTestShare` and a tool error
  `TESTS_FAILED_TOO_MANY` above it; a timed-out, interrupted or `maxFailures`-stopped run is
  `RUN_INCOMPLETE`, a sharded run `RUN_SHARDED`.
- Console summary of a run report: header with mode, environment, tests and CI commit; tool
  errors and up to 10 warnings with hints; counters per kind and muted keys; a table of
  violations (blocking first, by relative exceedance, at most 20 rows, keys shortened in the
  middle to fit the terminal width) with the `over` percentage and `HARD` and `MUTED` flags;
  the slowest sample of the first blocking keys; the result line and the report paths.
- Derivation of thresholds files from a run report: per key `t`, `median`, the evaluated
  percentile, `p99`, `minApdex`, `maxWilson` and `maxErrorRate` from the margins in
  `checks.*.margin`, `checks.slowShare.t.<kind>` and `thresholds.smallSampleN`, rounded towards
  the looser limit. A derived entry always passes the run it was derived from, and its limits
  keep `median ≤ percentile < p99`. Keys whose median is above `checks.slowShare.t.<kind>.max`
  get no `apdex` and `wilson` limits; keys with fewer successful samples than
  `checks.time.median.minSamples` get no entry.
- Existing thresholds files are updated, not replaced: `locked` and hand-written partial entries
  stay byte for byte, `note`, `gate` and `until` are kept on every recomputed entry, entries of
  keys not seen in the run stay unless `--prune` is given, and `thresholds.update: "new-only"`
  only adds new keys. An entry whose new limits are within `thresholds.hysteresis` and that
  still passes the source run stays as it is, so a repeated derivation does not rewrite the
  file. A file is written only when its entries, the derivation settings, the environment, the
  evaluated percentile or the run conditions (browsers, machine, normalization, Playwright
  major.minor) changed; its `generated` block describes the source run.
- Derivation refusals `THRESHOLDS_SOURCE_INCOMPLETE` (interrupted or timed-out run, tool
  errors), `THRESHOLDS_EMPTY_REPORT`, `THRESHOLDS_NOTHING_TO_DERIVE` and an invalid existing
  thresholds file; warnings `THRESHOLDS_KIND_SKIPPED`, `THRESHOLDS_MANUAL_FILE`,
  `THRESHOLDS_SOURCE_TESTS_FAILED`, `THRESHOLDS_SOURCE_TEST_MODE`, `THRESHOLDS_ENV_MISMATCH`,
  `THRESHOLDS_SOURCE_MISMATCH` and `THRESHOLDS_LOOSENED_MUCH` (a time limit grew by more than
  `thresholds.loosenWarnRelative`).
- Thresholds diff per file: every key as added, removed, loosened, tightened, mixed, unchanged
  (also within hysteresis), locked, unseen or skipped, with the limit values before and after;
  large loosenings are marked `!` and expired mutings are listed on their own line. Console
  output (at most 30 rows per file, keys shortened to the terminal width) and Markdown for
  `thresholds-diff.md` (every change, for a PR description).
- `withPerf()` and `definePerfConfig()` in `playwright-performance-regression/config`. Outside
  perf mode `withPerf()` returns the Playwright config object as it is and does nothing else. In
  perf mode (`PW_PERF_MODE=test` or `thresholds`, with `PW_PERF_REPEAT`, `PW_PERF_ENV`,
  `PW_PERF_RUN_ID`, `PW_PERF_OUTCOME_FILE` and `PW_PERF_PRUNE`) it resolves the package config
  and returns a copy of the Playwright config with one worker, no retries, `maxFailures` and
  `globalTimeout` 0, trace, video and screenshots off, and `repeatEach` set to the number of
  repetitions for measured projects only (their dependencies and teardowns run once). Measured
  projects follow `run.projects` (`"auto"`: Chromium projects that are not a dependency or
  teardown of another project); other projects are removed from the run. Only the console
  reporters (`list`, `line`, `dot`, `github`), `run.keepReporters` (a kept `html` reporter never
  opens) and the package reporter stay; a console reporter is added when none is left.
- Errors that stop a perf-mode run before any test: `MODE_INVALID_VALUE` (an invalid `PW_PERF_*`
  value never turns perf mode off silently), `CONFIG_UNKNOWN_PROJECT` and
  `CONFIG_NO_MEASURED_PROJECT`; warnings `CONFIG_MULTIPLE_ENGINES`, `CONFIG_SLOW_MO`,
  `CONFIG_CHANGED_IN_PROCESS` and `NOT_WRAPPED_WITH_PERF`, kept for the reporter.
- `withPerfFixtures()` and `trackContext()` in `playwright-performance-regression/fixture`, and a
  ready `test` and `expect` in `playwright-performance-regression/test`. Outside perf mode
  `withPerfFixtures()` only adds the `perf` fixture; Playwright's `context` and `page` are not
  overridden. Wrapping a test object again changes nothing.
- Request measurement in perf mode for the tests of measured projects: every request of the
  `context` fixture, of the `page` fixture's context (also a page built on its own context,
  with the informational diagnostic `COLLECTOR_CONTEXT_AUTO_TRACKED`), of contexts passed to
  `perf.track()` and of worker-scoped contexts registered with `trackContext()`, including
  popups, new tabs, frames and workers. Filters from `measure.*` (scheme, resource type, file
  extension at the end of the path, `include`, `exclude`) and a built-in list of 30 analytics,
  tag manager, monitoring and chat hosts (`measure.excludeKnownThirdParty`). Requests started by
  a service worker are skipped; responses generated by one are flagged `fromServiceWorker`.
  Each redirect step is its own sample.
- Sample timing from the browser: `duration` from request start to the last byte (including
  queueing, connection setup and a CORS preflight), `requestStart` and `ttfb`, rounded to
  0.1 ms; the worker clock (`timeSource: "node"`) when the browser gives no end time.
- End of test: requests in flight are awaited once per test, before Playwright closes the
  context, for at most `measure.pendingTimeoutMs` and never past the teardown time limit (the
  test timeout minus 1 s for other teardowns). Requests still running after that become
  `PENDING` samples; a response whose body was never read keeps its HTTP status without a
  duration. Requests of a page or context closed by the test fail at once with the text
  `pw-perf: context closed`, without waiting.
- Every test of a measured project gets the attachment `playwright-performance-regression-samples`
  (also an empty one); projects that are not measured, such as a login setup project, are not
  measured. At most 20 000 request samples per test (`COLLECTOR_SAMPLE_LIMIT_REACHED`).
  Collector errors never change a test result: they become the diagnostics
  `COLLECTOR_LISTENER_ERROR` and `COLLECTOR_TIMING_FAILED`, or `COLLECTOR_ATTACH_FAILED` on
  stderr.
- Custom measurements with the `perf` fixture: `perf.measure(name, fn)`, `perf.start(name)` and
  `perf.end(name)` (returns the duration in ms, also outside perf mode), the aliases
  `sampleStart`/`sampleEnd`, outcomes `ok`, `error` and `unfinished`, name validation
  (`TypeError` with `CUSTOM_INVALID_NAME`) and the diagnostics `CUSTOM_ALREADY_STARTED`,
  `CUSTOM_END_WITHOUT_START` and `CUSTOM_UNFINISHED`.
- The package reporter (`playwright-performance-regression/reporter`), added by `withPerf()` in
  perf mode. It aggregates the sample attachments of the measured projects, evaluates them
  against the thresholds files of the run's environment label
  (`<thresholds.dir>/<thresholds.filePrefix>.<kind>[.<env>].json`, never the file without the
  label), writes
  `<report.dir>/report.json`, prints the summary (colors only in a terminal without
  `NO_COLOR`, tables fitted to the terminal width) and writes the outcome file to
  `PW_PERF_OUTCOME_FILE`. In `thresholds` mode it also writes the changed thresholds files and
  `<report.dir>/thresholds-diff.md` and prints the diff after the summary; nothing is written
  for an incomplete or untrustworthy run, and `PW_PERF_PRUNE=1` removes entries not seen in the
  run. Playwright's status becomes `failed` when the exit code of the run is not 0. At the start
  of the run it prints the settings perf mode changed and the number of test executions. A run
  that starts no test (`--list`, a filter that selects nothing) writes and prints nothing.
- HTML report `<report.dir>/report.html` next to `report.json` (unless `report.html` is
  `false`): one self-contained file without network requests, readable without JavaScript, with
  the verdict, counters, muted keys, warnings, endpoint and custom measurement tables (violations
  first, details per key with checks, a percentile bar, statuses, slowest samples and top tests),
  thresholds files, run conditions and the config snapshot. JavaScript adds sorting, filters and
  a download of the embedded data (aggregates without raw samples). Light and dark theme, print
  styles and a Content-Security-Policy without inline exceptions. Tool errors
  `HTML_RENDER_FAILED` and `HTML_WRITE_FAILED` keep `report.json` and end with exit code 3.
- Reporter warnings `RUN_CONDITIONS_CHANGED` (other workers, retries or repetitions than perf
  mode sets, retried results or trace and video attachments set in test files),
  `TESTS_NOT_INSTRUMENTED`, `ATTACHMENT_DUPLICATE`, `COLLECTOR_REQUESTS_PENDING` (with the keys
  that have the most pending requests), `CONFIG_DUPLICATE_ORIGIN_LABEL` for `use.baseURL` of
  measured projects, `NOT_WRAPPED_WITH_PERF` and `THRESHOLDS_DIFF_WRITE_FAILED`; tool errors
  `RUN_SHARDED`, `REPORT_WRITE_FAILED`, `THRESHOLDS_WRITE_FAILED` and
  `REPORTER_INTERNAL_ERROR`; `OUTCOME_WRITE_FAILED` on stderr. A sample attachment that cannot
  be read is skipped with a tool error.
- The `pw-perf` command (also `playwright-performance-regression`): `pw-perf test` and
  `pw-perf thresholds` run `playwright test` in perf mode. Own options `--env`, `--repeat` and
  (thresholds) `--prune` are read anywhere before `--`; every other argument goes to Playwright
  unchanged, and `--config`/`-c` belongs to Playwright. `--repeat` and `--env` are checked like
  `PW_PERF_REPEAT` and `PW_PERF_ENV`. Playwright is found in the project (from the directory of
  `-c` when given, so a monorepo can run `pw-perf test -c apps/web/playwright.config.ts` from its
  root) and started with Node, without a shell. With `--reporter` the package reporter is added to
  the last `--reporter` value. The CLI sets the `PW_PERF_*` variables, prints the mode line and a
  tip to measure a subset, forwards SIGINT and SIGTERM to Playwright (a second Ctrl+C within 5 s
  stops it at once) and ends with the exit code of the outcome file: 0, 2 or 3, 130 or 143 after a
  signal, Playwright's own code with `--list`. Without an outcome file the result is 3 with
  `CLI_OUTCOME_MISSING` and its usual causes (no `withPerf()`, a config error, no matching test).
  After the run it prints one result line and the report path.
- CLI errors `CLI_UNKNOWN_COMMAND`, `CLI_INVALID_OPTION`, `CLI_MISSING_ARGUMENT`,
  `CLI_UNSUPPORTED_PLAYWRIGHT_OPTION` (`--ui`, `--ui-host`, `--ui-port`, `--debug`, `--shard`),
  `CLI_PRUNE_WITH_FILTER` (`--prune` with `--grep`, `--grep-invert`, `--project`,
  `--last-failed`, `--only-changed`, `--test-list` or file paths), `CLI_FROM_WITH_PLAYWRIGHT_ARGS`,
  `CLI_PLAYWRIGHT_NOT_FOUND`, `CLI_REPORTER_PATH_UNSUPPORTED`, `CLI_SPAWN_FAILED`,
  `CLI_OUTCOME_INVALID`, `CLI_REPORT_NOT_FOUND`, `CLI_WRITE_FAILED` and `CLI_INTERNAL_ERROR`;
  warnings `CLI_MODE_ALREADY_SET` and `CLI_PLAYWRIGHT_UNSUPPORTED_VERSION`.
- `pw-perf thresholds --from <report.json>` derives the thresholds files from a run report without
  running tests, with the same functions as a thresholds run (identical files), and writes
  `thresholds-diff.md`. The environment label is `--env` or the label of the report;
  `CLI_REPORT_TESTS_FAILED` warns about a report with failed tests. It needs no Playwright.
- Package config in the commands without tests: `--config <file>`, else `pw-perf.config.*`
  (`.ts`, `.mts`, `.js`, `.mjs`, `.cjs`, `.json`) in the current directory or in the config
  directory of the report, else the config snapshot of the report. TypeScript files are loaded by
  Node itself; a file that cannot be loaded gives `CONFIG_FILE_LOAD_FAILED` with a fix hint for
  imports without extension, `tsconfig` path aliases and enums (an error with `--config`, a
  warning and the snapshot otherwise), and Node's type-stripping warnings become one `note:` line.
  `CONFIG_FILE_NOT_FOUND` for a missing `--config` file, `CONFIG_SNAPSHOT_DIFFERS` when the file
  differs from the snapshot in options that change the result. The CLI prints the config source
  and the base directory of relative paths (`CLI_CONFIG_DIR_MISSING` when it falls back to the
  current directory).
- `pw-perf report [--input] [--output] [--config]` renders the HTML report again from a run
  report (`CLI_REPORT_NOT_FOUND` when it is missing), also with `report.html: false`; the page is
  identical to the one written by the run. It needs no Playwright. `HTML_RENDER_FAILED` and
  `CLI_WRITE_FAILED` end it with exit code 3. `--help` (also per command, with the
  note on repeated tests and data conflicts) and `--version`.
- `pw-perf init [--yes] [--dry-run]`: guided setup in eleven steps, each with a short explanation.
  It reads the project as text (playwright.config is never imported), asks for the label of the
  `baseURL` origin, which tests to measure (all or `@perf`, with `INIT_NO_TAGGED_TESTS` when no
  test has the tag), the repetitions, a warn-only start, environments and a CI job, and shows a
  diff of every change before it asks to apply it: a new `pw-perf.config.ts` with only the values
  that differ from the defaults, `withPerf()` around `export default defineConfig({...})`,
  `export default {...}` or `module.exports = ...`, `withPerfFixtures()` around
  `export const test = base.extend(...)` (or `exports.test = ...`), or imports of `test` from
  `@playwright/test` switched to `playwright-performance-regression/test`, `perf-results/` in
  `.gitignore`, `perf:test` and `perf:thresholds` scripts (with `--grep @perf` and one pair per
  environment with `--env`), and a CI job file from `examples/ci/` for GitHub Actions, GitLab CI,
  Jenkins or Azure Pipelines. Other layouts (config wrappers, several test objects, `mergeTests`)
  and existing scripts or CI files are left as they are, with an `INIT_MANUAL_STEP` instruction.
  A second run changes nothing; an existing `pw-perf.config.ts` is replaced only after its own
  confirmation (never with `--yes`). Without a terminal and without `--yes` it only shows the
  plan. Exit codes: 0 done, 3 `INIT_NO_PLAYWRIGHT_CONFIG`, `INIT_PLAYWRIGHT_TOO_OLD` or
  `INIT_WRITE_FAILED`, 130 interrupted (nothing is written before the changes step).
- `create-playwright-performance-regression` for `npm init playwright-performance-regression`
  (also `pnpm create` and `yarn create`): installs the package of the same version as a dev
  dependency with the package manager of the project's lockfile, without a shell, then runs
  `pw-perf init` with the given arguments.
- CI recipes in `examples/ci/` (`github-actions.yml`, `gitlab-ci.yml`, `Jenkinsfile`,
  `azure-pipelines.yml`): pull request and nightly triggers, the report uploaded always, exit
  code 2 as a soft failure on GitLab, Jenkins and Azure Pipelines, and a time limit.
- User documentation: a README with installation, quick start, CI, limitations, privacy and
  compatibility, and `docs/` with configuration (generated from
  `schemas/config.schema.json`), CLI, adoption in existing projects, thresholds, CI,
  troubleshooting for every warning and error code, FAQ, and upgrading.
- Example projects `examples/basic` and `examples/with-setup`, runnable against the demo app of
  the repository.
- Both packages are published from GitHub Actions with npm provenance (trusted publishing), in
  the same version, with pre-releases under the `next` dist-tag; a demo HTML report with a
  blocking violation is published on GitHub Pages.

### Changed

- `schemas/samples.schema.json`: field descriptions now say that `duration` is `null` also for
  a response that never finished, that `requestStart` and `ttfb` never include a CORS preflight,
  and that `failureText` can be the collector's context-closed text. The structure is unchanged.
- File validation messages describe the expected format of an environment label or percentile
  name (e.g. `a percentile name like "p95"`) instead of printing the regular expression.
- Smaller package: the entry points share code chunks instead of each bundling its own copy
  (about 820 kB unpacked instead of 1.3 MB). Every entry point keeps its ESM and CommonJS build.
- The descriptions in the published `schemas/*.json` use the real names
  (`pw-perf.config.json`, `PW_PERF_ENV`, `PW_PERF_REPEAT`, `PW_PERF_OUTCOME_FILE`, the
  `playwright-performance-regression-samples` attachment) instead of placeholders.
