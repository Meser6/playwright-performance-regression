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
  `{ regex, flags }` URL patterns, environment overrides of `run.env` and `run.repeat`, and a
  JSON snapshot of the effective config for the run report.
- Config validation that reports all problems at once, with the option path, the value received,
  the expected format and, for a mistyped option, the closest known name: error codes
  `CONFIG_UNKNOWN_OPTION`, `CONFIG_INVALID_TYPE`, `CONFIG_INVALID_VALUE` and
  `CONFIG_INVALID_REGEX`; warnings `CONFIG_DUPLICATE_ORIGIN_LABEL`,
  `CONFIG_RESOURCE_TYPE_LONG_LIVED` and `CONFIG_PERCENTILE_IS_P99`.

### Changed

- `schemas/samples.schema.json`: field descriptions now say that `duration` is `null` also for
  a response that never finished, that `requestStart` and `ttfb` never include a CORS preflight,
  and that `failureText` can be the collector's context-closed text. The structure is unchanged.
- File validation messages describe the expected format of an environment label or percentile
  name (e.g. `a percentile name like "p95"`) instead of printing the regular expression.
