# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- **Breaking:** the `pw-perf` commands and options are gone: `pw-perf test`, `thresholds`,
  `check`, `report`, `init`, `thresholds --from`, `--env`, `--passes`, `--prune`, `--max-tests`,
  `--config`, `--input`, `--output`, `--help` and `--version`. Run your test command with the
  variables instead, e.g. `PW_PERF_MODE=test PW_PERF_PASSES=3 npx playwright test`. The HTML
  report is written by every run, so there is no command to render it again; thresholds come
  from a `PW_PERF_MODE=thresholds` run (the CI thresholds job and its artifact). The codes of the
  runner (`CLI_INVALID_OPTION`, `CLI_OUTCOME_MISSING`, `CONFIG_FILE_LOAD_FAILED`, …) are removed.
  `perf:*` scripts written by an early wizard no longer work; remove them.
- **Breaking:** the wizard takes no options. `npx pw-perf` without arguments starts it in a
  project with the package installed (any argument is `CLI_UNKNOWN_COMMAND` with the help), and
  `npm init playwright-performance-regression` takes no arguments either. Use
  `PW_PERF_LANG=<code>` instead of `--lang`, `PW_PERF_DRY_RUN=1` instead of `--dry-run` and
  `PW_PERF_NO_TUTORIAL=1` instead of `--no-tutorial`. `--yes` has no replacement: the wizard
  writes changes only in a terminal (press Enter for each default); without one it shows the
  plan.
- The `Continue? (Y/n)` question under the start banner is gone, and so is `PW_PERF_YES`: the
  banner only informs and the run starts right away in every mode (press Ctrl+C to stop it). A
  set `PW_PERF_YES` is ignored.
- **Breaking:** `run.projects` is gone. The measured projects are the ones your test command
  selects (`--project`; all projects without it), except setup and teardown projects (named in
  `dependencies` or `teardown` of another project), which run once per pass and are not measured.
  `withPerf()` no longer removes projects from the run and the browser engine no longer decides:
  select one engine with `--project`, e.g. `PW_PERF_MODE=test npx playwright test --project
chromium` (samples of several engines give `STATS_MULTIPLE_BROWSERS`). `run.projects` in the
  config is `CONFIG_UNKNOWN_OPTION`; `CONFIG_UNKNOWN_PROJECT` and `CONFIG_MULTIPLE_ENGINES` are
  removed, and `CONFIG_NO_MEASURED_PROJECT` now comes from the reporter when the command runs only
  setup or teardown projects. The wizard no longer asks which projects to measure. Run reports
  have `schemaVersion` 4; version 3 reports are migrated (their `config.run.projects` is
  dropped).

### Changed

- Wizard, step "What to measure": the `api` lesson says that it also covers `request` calls in
  API tests (all seven languages).
- **Breaking:** the default `report.dir` is now `reports/pw-perf/` (was `pw-perf-results/`).
  `report.html`, `report.json`, `outcome.json`, `pass-<k>.json` and `thresholds-diff.md` are
  written directly into it. Only `reports/pw-perf/` is emptied when a run starts; the parent
  `reports/` folder and the reports of other tools in it are never touched. To migrate: replace
  `pw-perf-results` with `reports/pw-perf` in `.gitignore` and in your CI jobs (the artifact path
  and the `outcome.json` path; the GitHub and Azure artifact is now named `pw-perf-report`), and
  delete the old `pw-perf-results/` folder. To keep the old folder, set
  `report: { dir: 'pw-perf-results' }`. The wizard adds `reports/pw-perf/` to `.gitignore` unless
  `reports/` is ignored already.
- HTML report: the view switch (Overview, Endpoints, Steps, Tests, …) is a row of tabs. The
  selected tab has an accent underline and background, every tab is at least 44 px high, and on a
  narrow screen the bar scrolls to show the selected tab.
- `pw-perf.config.ts` written by the wizard is short: the 15 most important options (including
  `measure.api`, `measure.steps` and `run.overrideSlowMo`), each with a short comment, and a link
  to the full option list in `docs/configuration.md`. The "Most important settings" block and the
  comments for every other option are gone.
- The check at the end of the wizard runs your test command like the real runs: first with
  `PW_PERF_MODE=thresholds`, then with `PW_PERF_MODE=test`, both with `PW_PERF_PASSES=2`, instead
  of once with `PW_PERF_MODE=check`. The thresholds of the check go to a temporary folder that is
  deleted afterwards; your thresholds files are not touched. The wizard shows the exit code of
  each run.
- The wizard no longer shows the check step when it shows the red "Action needed: nothing is
  measured yet" box; the summary still suggests the check. With the answer `steps` to "What to
  measure?" there is no red box, because steps are measured without the `perf` fixture.
- The wizard no longer asks which test script runs your tests and has nine steps (`[n/9]`). The
  commands it shows and writes to the CI jobs use the plain Playwright command of your package
  manager (`npx playwright test`, `pnpm exec playwright test`, `yarn playwright test`); put your
  own test command in its place, e.g. `PW_PERF_MODE=test npm run e2e:qa`. The check at the end
  runs the Playwright CLI. The warnings `INIT_SCRIPT_FLAG` and `INIT_SCRIPT_LATER_STEPS` are
  removed.
- The wizard asks for your usual test command (new step 6, steps `[n/10]`), with the command of
  your package manager as the default (Enter) and `skip` to skip the check. The typed command is
  used as typed in the summary commands, in the CI jobs (quoted for GitLab YAML and Jenkins
  Groovy) and for the check, which runs it through your shell with `PW_PERF_MODE=check`.
- Step 4 of the wizard asks "What to measure? [all/api/steps]" instead of whether to measure
  `test.step` blocks, and is asked in every project, also without `test.step` calls. `all` (the
  default) keeps both kinds on, `api` writes `measure: { steps: false }` and `steps` writes
  `measure: { api: false }`.
- Step 1 of the wizard no longer lists what it detected (files, `baseURL`, projects, CI). It
  says what the package does, how to run it (`PW_PERF_MODE=thresholds <your test command>`,
  commit the thresholds files, then `PW_PERF_MODE=test <your test command>` locally and in CI,
  with `--project <name>` to measure one browser), the other `PW_PERF_*` variables and which
  files to commit. The Playwright version shows up only as an error when it is too old.
- Every `test` and `thresholds` run empties `report.dir` (default `reports/pw-perf/`) when its
  first test starts, so reports of earlier runs never stay next to the new ones. A guard keeps
  the folder when it is the project directory, the `playwright.config` directory, the home
  directory, the filesystem root, `thresholds.dir`, a folder containing one of them, or a folder
  with thresholds files, `package.json`, `playwright.config.*` or `.git`; the run then warns with
  `RUN_REPORT_DIR_NOT_CLEANED`. A check and a run without started tests remove nothing.

- `measure.steps` is on by default: `test.step` blocks give step keys, a
  `pw-perf-thresholds.steps.json` file and fail the run like endpoints, without any config.
  Set `measure: { steps: false }` to measure only backend requests. A run without any
  `test.step` prints one informational line instead of the `STEPS_NONE_FOUND` warning, which is
  removed.
- Hints, the help, the `Next:` line, the wizard, the README and `docs/` show only the
  environment form, `PW_PERF_*=… <your test command>`, and
  `npm init playwright-performance-regression` for the guided setup; they no longer suggest `npx pw-perf`
  commands or their options (e.g. `THRESHOLDS_FILE_MISSING` now says "Derive thresholds with
  `PW_PERF_MODE=thresholds <your test command>`"). `docs/cli.md` is now "Running". The examples
  run with `PW_PERF_MODE=… npm test` instead of `perf:*` scripts.

### Fixed

- Types of `playwright-performance-regression/config`, `/fixture`, `/test` and `/reporter`
  resolve in TypeScript projects without `exports` support (`"module": "commonjs"` with no
  `moduleResolution`, i.e. `node10`): `tsc` no longer fails with `Cannot find module`, and a
  wrapped `test` keeps its fixture types instead of `any`.
- `PW_PERF_MODE=check`: the top keys say `1 sample · 1 test` instead of `1 samples · 1 tests`.
- HTML report: the Source column of the Endpoints table (`browser`, `request`) is an ordinary
  cell, aligned with the rest of the row, instead of a badge stuck to the top of the row.
- The wizard's red box (`INIT_TEST_OBJECT_MANUAL`) is full width in a pseudo-terminal that reports
  0 columns (e.g. `expect`, `docker -t`) instead of being cut to 40 columns.
- HTML report: the key labels of a waterfall (Tests tab) are monospace with the method in its
  colour again; in Chromium they were unstyled and a long method such as `DELETE` overlapped the
  path.
- `request` calls of a browser context with its own `baseURL` (`browser.newContext({ baseURL })`
  with `perf.track()` or `trackContext()`) get keys of that origin: relative URLs no longer
  resolve against the test's `baseURL`; such calls take the URL of the response.
- HTML report: long endpoint and step names no longer run into the next column. In the
  Endpoints and Steps tables the name wraps inside the Key cell; in the Overview cards it is cut
  with an ellipsis and the full name is shown on hover.
- A `PW_PERF_MODE=thresholds` run no longer warns with `THRESHOLDS_FILE_MISSING` about the
  thresholds file it is creating.
- With `PW_PERF_PASSES` above 1, `PW_PERF_MODE=… npx playwright test` no longer starts pass 2
  as `npm run npx` ("Missing script"): a package script runs again only when `package.json` has
  it. The `Next:` hint no longer suggests `npm run npx` either.
- `TESTS_NOT_INSTRUMENTED` counts tests instead of test results and names up to three files,
  e.g. `2 tests in tests/api.spec.ts import test without withPerfFixtures() …`; a crashed worker
  is mentioned only when a worker actually crashed.

### Added

- Warning `CONFIG_FILE_NOT_PASSED`: a `pw-perf.config.*` file next to the Playwright config is
  no longer ignored silently when `withPerf(config)` gets no second argument; the run still uses
  the defaults, and the hint shows how to pass the file.
- Calls of Playwright's `request` fixture, `page.request` and `context.request` are measured
  (API tests and data setup in UI tests), with `measure.api` on (the default). They get their own
  keys with the prefix `request`, e.g. `request GET /api/orders/:id`, next to the browser's
  `GET /api/orders/:id`: the two are timed differently (worker clock vs browser timing), so each
  gets its own entry in `pw-perf-thresholds.json` and its own limits. The Endpoints table of the
  HTML report has a Source column (`browser` / `request`). Contexts from
  `playwright.request.newContext()` are measured after `perf.trackRequestContext(context)` or
  `trackRequestContext(context)` from `playwright-performance-regression/fixture`. API tests must
  import `test` from the wrapped test object, otherwise `TESTS_NOT_INSTRUMENTED` names them.
  The sample batch attachment moves to schema version 3 (`apiRequests`); the run report and the
  thresholds files keep their versions. If you excluded API-only projects from the measurement
  command because of `RUN_PROJECT_NO_REQUESTS`, you can add them back.
- The HTML report has a stopwatch logo in its header and as the page icon (an inline
  `data:` URI, no extra files).
- `run.overrideSlowMo` (default `false`): when `true`, perf mode sets
  `use.launchOptions.slowMo` to 0 in every measured project and lists `slowMo` in the
  "perf mode overrides …" line. With `false`, the `CONFIG_SLOW_MO` warning stays and now points
  to the option.
- `measure.api` (default `true`): set it to `false` to measure only `test.step` durations. No
  request is recorded, the endpoint thresholds file is neither read nor written, and tests do
  not need to import `test` from a wrapped test object (no `TESTS_NOT_INSTRUMENTED`). Turning
  off both `measure.api` and `measure.steps` is `CONFIG_INVALID_VALUE`.

## [0.1.0-next.3] - 2026-11-21

`0.1.0-next.2` was tagged but not published (the release stopped on the performance tests).

### Added

- `thresholds.preset`: `strict`, `normal` (default, the previous margins) or `loose` sets the
  headroom of every derived threshold; fields in `checks.*.margin` still win.
- `run.grep`: only tests whose title or tags match run in perf mode (e.g. `'@perf'`), applied to
  the measured projects only, so setup projects run in full.
- `pw-perf.config.ts` written by `init` starts with a "Most important settings" block.

- Passes: a run now runs your test command several times in a row (`run.passes`: 5 for `test`,
  10 for `thresholds`; `PW_PERF_PASSES` or `--passes` for one run) instead of repeating each test
  inside one Playwright run. Setup steps of the script (seeding data) run before every pass. Each
  pass writes `pw-perf-results/pass-<k>.json` and the first pass evaluates all of them together:
  one report (with `passes` in `report.json` and a "Passes" tile) and one result. A pass without
  data gives `RUN_PASS_FAILED`; an interrupted pass `RUN_PASS_INTERRUPTED`. See `docs/cli.md`.
- A start banner with the mode, projects, tests × passes, a time estimate and the report path; in
  a terminal outside CI it asks `Continue? (Y/n)` (`PW_PERF_YES=1` skips it).

- `check`: a dry run before the first measurement (`PW_PERF_MODE=check npm run e2e`, or
  `npx pw-perf check`). It runs the first test of each file once (at most `--max-tests`,
  `PW_PERF_MAX_TESTS`, default 10) and shows the projects, origins with their labels, top keys,
  the thresholds files and an estimate of the full runs; it evaluates nothing and writes no files.
  `CHECK_RANDOM_HOST` proposes host patterns for generated CI hosts.

- Host patterns in `keys.origins`: `'https://*.ci.example.com': ''` labels random hosts of CI
  instances; `*` matches inside one host label, an exact entry wins, more literal characters win
  between patterns. `baseURL` origins covered by `keys.origins` no longer change the
  normalization fingerprint, so random `baseURL` hosts stop giving `THRESHOLDS_SOURCE_MISMATCH`.
  Thresholds files derived before with an exact entry for the `baseURL` origin give
  `THRESHOLDS_SOURCE_MISMATCH` once. See `docs/dynamic-environments.md`.

- After every run the last line is a `Next:` hint with the exact command of your project: derive
  thresholds (`PW_PERF_MODE=thresholds npm run e2e`), commit the written files, or run the check
  when nothing was measured. The command follows how the run was started (npm, pnpm or yarn
  script, plain `npx playwright test`, or `npx pw-perf`).
- Warnings `RUN_PROJECT_NO_REQUESTS` (a measured project with only API tests) and
  `CONFIG_BASEURL_EMPTY` (an empty `use.baseURL` or one built from an unset variable).

- Environment mode as the recommended way to run: `PW_PERF_MODE=test npm run e2e` (or `thresholds`)
  runs your own test command in perf mode. The reporter writes the exact result to
  `pw-perf-results/outcome.json` (exit code 0, 2 or 3; the old file is removed when the run starts)
  and prints an `Outcome:` line; Playwright keeps its own exit code. `withPerf()` gives the workers
  the run id and warns about `--reporter` (`RUN_REPORTER_FLAG`) and `--ui`/`--debug`
  (`RUN_UNSUPPORTED_FLAG`); `PW_PERF_PRUNE=1` with a test filter writes the files without pruning
  (`RUN_PRUNE_SKIPPED`). See the new section of `docs/cli.md`.

- Step timings: with `measure: { steps: true }` the durations of the existing `test.step` blocks
  become keys of kind `step` (for example `login › submit`), checked and derived like endpoints,
  with their own thresholds file `pw-perf-thresholds.steps.json`, a `Steps:` line in the console
  and a Steps tab in the HTML report. Step titles are sanitized: ids, e-mails, URLs and secrets
  never reach the keys or the reports, also inside quotes. Options `categories`, `maxDepth`,
  `include`, `exclude`, `groupBy`, `normalizeTitles` and `redactQuotedValues`; warnings
  `STEPS_NONE_FOUND`, `STEPS_HIGH_CARDINALITY`, `STEPS_TOO_MANY_KEYS` and
  `STEPS_SECRET_REDACTED`. `init` asks about it when the project has `test.step` calls. See
  `docs/steps.md`.

- The run report (`report.json`) holds more data for the HTML report: a
  histogram of the retained durations per key, the median time outside TTFB
  (`ttfb.otherP50`), the part of each limit a check uses (`usage`), up to three rule-based hints
  per key, and `testBreakdown`: the backend cost of the 500 most expensive tests and a request
  waterfall of the 5 slowest test runs.

### Changed

- The HTML report has a new look: an app bar with the run details, a verdict card with the three
  results (performance, tests, tool errors) and the exit code, a KPI strip, sticky tabs, violation
  cards with the first hint, rankings with bars and an Endpoints/Steps switch, endpoints shown with
  a colored method badge and highlighted path parameters, and failures in a clear red (light and
  dark theme). Key details open in a centered dialog (`Esc`, Close or a click outside closes it;
  full screen on phones). The details show p50, the evaluated percentile, p99 and max at a glance, the histogram bars above the limit in red and a headroom
  meter for every check. Times in the key tables are whole milliseconds without a unit (the table
  footer says “All times in ms”). Error rates in the checks are shown as percentages.
- The run summary and the `check` output are easier to scan: errors, warnings and the verdict
  are in framed boxes, the counters and the violations in tables with lines, and statuses carry
  emoji (✅ ⚠ ❌). Long warning messages wrap inside the box. `NO_COLOR` turns off only the
  colors; `TERM=dumb` also turns frames into ASCII and emoji into `✔ ! ✖`.
- The `TESTS_FAILED` warning now says that the samples of failed tests are counted.
- `pw-perf init` is rebuilt around your own test command: it detects the scripts that run
  `playwright test` and shows `Run: PW_PERF_MODE=test npm run <script>`, warns about flags that
  break a measurement run (`INIT_SCRIPT_FLAG`) and later steps of the script
  (`INIT_SCRIPT_LATER_STEPS`), asks which projects to measure, writes `@perf` as `run.grep`,
  asks for the headroom preset, no longer asks about a trial period or environments, and ends
  with a check. Steps 1 and 2 are one step with a short description of the package.
- When the wizard cannot wrap your fixtures module it changes no test file and shows a red box
  with the code to paste (`INIT_TEST_OBJECT_MANUAL`). Without `playwright.config` it stops before
  the first question.
- The CI recipes in `examples/ci/` (and the files `init` writes) have two jobs: a thresholds job
  you start by hand that keeps the thresholds files as an artifact, and a weekly measurement job;
  both set `PW_PERF_MODE` and run your test command, and read the exit code from
  `pw-perf-results/outcome.json`.
- `npx pw-perf` without arguments prints the help instead of an error, with a box pointing to
  `npx pw-perf init` in a project without config.

- **Breaking:** `run.repeat`, `PW_PERF_REPEAT` and `--repeat` are renamed to `run.passes`,
  `PW_PERF_PASSES` and `--passes`; the old names are errors with a hint. Every project runs with
  `repeatEach: 1`.
- Perf mode no longer forces `retries: 0`: the retries of your Playwright config apply, every
  attempt is measured and a test that passes on a retry counts as passed. Retries no longer give
  `RUN_CONDITIONS_CHANGED`.
- `pw-perf test` and `thresholds` print no mode line before the run; the start banner replaces it.
- `npx pw-perf --help` starts with the recommended form (`PW_PERF_MODE=test npm run e2e`, also
  `thresholds` and `check`, with the Windows line) and presents the commands as the advanced
  runner; it lists `--max-tests`. The README quick start uses the same form and says where the
  result is (`pw-perf-results/outcome.json`).
- The HTML report size limit for 500 keys, 500 tests and 5 waterfalls is 10 MB (was 5 MB).
- The HTML report is redesigned: a verdict banner and key figures on top, tabs (Overview,
  Endpoints, Tests, Warnings, Run & config), the details of a key with
  links to it (`#key=api:<key>`, `#tab=tests`), search and filter chips, rankings (slowest, most
  called, highest error rate, closest to the limit), a histogram per key, the split of TTFB and
  the rest of the time, hints that explain a violation, the headroom to every limit, the backend
  cost of each test and a waterfall of the 5 slowest test runs. It still is one offline file that
  works without JavaScript, prints and adapts to the dark theme and small screens.
- `report.json` files written by `0.1.0-next.1` or earlier are migrated when read (`thresholds
--from`, `report`); the new fields are empty in them.
- Breaking: new format versions. The sample attachment is version 2 (without `custom`), the
  thresholds file version 2 (`kind` is `api`) and `report.json` version 3 (without `custom` and
  `evaluation.counts.custom`). Thresholds files of version 1 and run reports of versions 1 and 2
  are migrated when read; the package writes the new versions. A thresholds file of kind
  `custom` is rejected with `SCHEMA_VALIDATION_FAILED`.

- Breaking: the endpoint thresholds file has no kind in its name: `pw-perf-thresholds.json`
  (`pw-perf-thresholds.<env>.json` with an environment label), was `pw-perf-thresholds.api.json`.
  Rename the file with `git mv pw-perf-thresholds.api.json pw-perf-thresholds.json`; the old name
  is not read. The environment labels `steps` and `requests` are reserved.
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
- Measurement runs replace the `list` reporter with `dot` and add `dot` (also locally) when no
  console reporter is left, so hundreds of executions no longer flood the terminal. Keep `list`
  with `--reporter=list` or `run.keepReporters: ['list']`. The info line at the start says
  `reporter list replaced with dot`.
- The run summary is easier to spot and read: a separator line and a bold header, bold section
  headings, red error codes, yellow warning codes, dim hints, red blocking and yellow
  non-blocking rows, and the verdict as a colored badge (`✔ PASSED`, `! PASSED WITH WARNINGS`,
  `✖ FAILED`, `✖ ERROR`). Without colors the text keeps the same words and markers.
- The summary ends with one `Report:` line with the absolute path of `report.html` (or
  `report.json` without HTML), and the thresholds diff with an absolute `Diff:` path; the CLI no
  longer prints the `report:` and `thresholds diff:` lines after them.
- The counters line omits zero counts and says what it counts, e.g. `19 keys · 19 from file ·
8 checked by median only (few samples) · 2 file entries not seen`.
- `THRESHOLDS_FILE_MISSING` is reported only for a kind that has keys in the run.

### Removed

- **Breaking:** `gate.warnOnly` (the trial mode). The option is now `CONFIG_UNKNOWN_OPTION` with a
  hint; to keep a CI job green on a regression, set `continue-on-error` on the job, or use
  `gate.tolerance` / `gate.defaultThresholds: 'warn'`.
- **Breaking:** `pw-perf init` no longer writes `perf:*` scripts to `package.json` and no longer
  changes test files (no import swap). Scripts written by an earlier wizard keep working.
- Breaking: custom measurements. `perf.measure()`, `perf.start()`, `perf.end()`,
  `perf.sampleStart()` and `perf.sampleEnd()` are removed; the `perf` fixture keeps only
  `perf.track(context)`, so old calls no longer type-check and throw a `TypeError` in JavaScript.
  The kind `custom` is gone with its thresholds file `pw-perf-thresholds.custom[.<env>].json`
  (no longer read or written; delete it by hand), the options `checks.*.*.limit.custom`,
  `checks.errors.limit.custom` and `checks.slowShare.t.custom` (now `CONFIG_UNKNOWN_OPTION` with
  a hint), the `CUSTOM_*` warnings, the `Custom:` line of the summary, the Custom tab of the HTML
  report and the migration notes for `playwright-performance`. Time user-visible steps with
  `test.step()` and `measure.steps: true` instead. See
  [Upgrading](docs/upgrading.md#from-010-next1-to-010-next3-custom-measurements-removed).

### Fixed

- A run with too many failed tests (`TESTS_FAILED_TOO_MANY`) or another run problem no longer
  reports "1 tool error" and "performance failed": the verdict names the cause (`too many failed
tests (30 of 101 executions); the performance result is not trustworthy`) and the CLI says
  `performance result not trustworthy`. The exit code stays 3.

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
