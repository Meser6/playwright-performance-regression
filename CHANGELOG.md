# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Package manifest with the entry points `playwright-performance-regression`, `/config`,
  `/fixture`, `/test`, `/reporter` and the `playwright-performance-regression` and `pw-perf`
  commands (placeholders, no functionality yet).
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

### Changed

- `schemas/samples.schema.json`: field descriptions now say that `duration` is `null` also for
  a response that never finished, that `requestStart` and `ttfb` never include a CORS preflight,
  and that `failureText` can be the collector's context-closed text. The structure is unchanged.
- File validation messages describe the expected format of an environment label or percentile
  name (e.g. `a percentile name like "p95"`) instead of printing the regular expression.
