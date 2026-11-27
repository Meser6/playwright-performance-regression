# Upgrading and uninstalling

## Upgrading

Update the package like any dev dependency and read the [CHANGELOG](../CHANGELOG.md) entry of the
new version first:

```sh
npm install -D playwright-performance-regression@latest
```

The project follows semantic versioning. Changes that affect your committed files are breaking
changes and are always listed with migration steps:

- **A new `schemaVersion` of the thresholds file.** Older files are still read and migrated in
  memory; a thresholds run writes the new format when it updates a file. A file written by a newer version
  of the package than the one installed is refused with `SCHEMA_VERSION_TOO_NEW`: upgrade the
  package on every machine and CI job that reads the file.
- **A change of the built-in URL normalization** (how URLs become endpoint keys). Keys in your
  thresholds files may then no longer match the keys of a run. The run warns with
  `THRESHOLDS_SOURCE_MISMATCH` (normalization) and `THRESHOLDS_UNSEEN_ENTRIES`. Re-derive the
  thresholds on CI ([Thresholds](thresholds.md#deriving-thresholds-the-recommended-flow)) and
  remove old keys with `PW_PERF_PRUNE=1` in a thresholds run of the full suite.

After upgrading, run the thresholds job in CI (`PW_PERF_MODE=thresholds` with your test command)
and review the diff before committing anything.

### From 1.0.x to 1.1.0

`1.1.0` adds features and changes no option you already set, but it changes the file formats and
two defaults that move the statistics a little. Upgrade every machine and CI job that reads the
thresholds files at the same time, then derive thresholds once.

1. **Formats are migrated for you.** The run report is now `schemaVersion` 5, the thresholds files
   3, the per-pass sample files 4. Older files are read and migrated in memory (an old thresholds
   file warns with `THRESHOLDS_FILE_OUTDATED`); the next thresholds run writes them in the new
   format, also for entries whose limits it keeps. `1.0.x` refuses a version 3 thresholds file with
   `SCHEMA_VERSION_TOO_NEW`, so do not commit new files before every job runs `1.1.0`.
2. **Cold samples are on by default** (`measure.coldSamples: 1`): the first sample of every key in
   each pass stays out of the evaluated statistics and the derived thresholds when enough warm
   samples remain ([Thresholds](thresholds.md#fast-failures-and-workload-changes)). Percentiles without a
   slow first call are a bit lower, so the first thresholds run after the upgrade may lower some
   limits slightly; review the diff as usual. Thresholds files from `1.0.x` are compared without a
   `coldSamples` warning. To keep the `1.0.x` behaviour, set `measure: { coldSamples: 0 }`.
3. **The `nonSuccess` rule needs a new thresholds run.** It fails a key whose share of responses
   outside `measure.successStatuses` (fast 401s, 500s) grew, but only for entries with
   `maxNonSuccessRate`, which a thresholds run of `1.1.0` writes. Until then nothing changes for
   your keys (except with `checks.nonSuccess.limit.api`). The same run adds the `source` block
   that the workload context (`THRESHOLDS_WORKLOAD_SHIFT`, the `Workload:` line) compares with.
   New warnings you may see: `THRESHOLDS_ENTRY_NOT_TIMED`, `THRESHOLDS_WORKLOAD_SHIFT`,
   `STATS_COLD_SLOW` ([Troubleshooting](troubleshooting.md)).
4. **Keys per GraphQL operation or tRPC procedure are opt-in.** Without
   [`keys.operations`](configuration.md#keysoperations) every key stays as it was. When you add it,
   the matched endpoints get new keys (`POST /graphql#GetTickets`): derive thresholds again and
   remove the old shared key with `PW_PERF_PRUNE=1` in a thresholds run of the full suite.
5. **Sharded runs work.** `--shard` in a measurement run no longer stops with `RUN_SHARDED`: each
   shard writes a shard file and a merge job runs `PW_PERF_MODE=merge npx pw-perf`
   ([Sharded runs](ci.md#sharded-runs)). Runs without `--shard` are unchanged.

### From 0.1.0-next.x to 1.0.0

`1.0.0` is the first stable release, under the `latest` dist-tag. The `0.1.0-next.N` versions were
pre-releases under `next`; coming from `0.1.0-next.3` or earlier, also follow the sections below.
To upgrade from `0.1.0-next.4`:

1. Install the stable version: `npm install -D playwright-performance-regression@latest` (the
   range in `package.json` becomes `^1.0.0`, so later `1.x` releases are picked up as usual).
2. Requests under `/sockjs/`, `/sockjs-node/`, `/signalr/` and `/_blazor/` are no longer measured
   by default (like `/socket.io/` before). If your thresholds files have such keys, the run
   reports them with `THRESHOLDS_UNSEEN_ENTRIES`; remove them with a thresholds run of the full
   suite with `PW_PERF_PRUNE=1`. If `pw-perf.config.*` sets `measure.exclude` (an earlier guided
   setup wrote it), the new patterns are not added for you: add them, or write
   `exclude: [...perfDefaults.measure.exclude, '/your/path/']`.
3. The guided setup no longer writes CI jobs. Jobs it wrote earlier are left as they are and keep
   working. To pick up the current recipes from [CI](ci.md) (the thresholds job uploads only
   `reports/pw-perf/`, which now also holds copies of the thresholds files; the measurement job
   publishes `junit.xml`), update your jobs by hand.
4. Nothing else to migrate: thresholds files, normalization and run reports keep their formats. A
   measurement run now also writes `reports/pw-perf/junit.xml` (`report.junit: false` turns it
   off), and an empty thresholds file warns with `THRESHOLDS_FILE_EMPTY`.

### From 0.1.0-next.3: no commands, only variables

The `pw-perf` commands and their options are gone, and so is `run.projects`. To upgrade:

1. Replace every `pw-perf test|thresholds|check …` call with your test command and variables:
   `PW_PERF_MODE=test npx playwright test` (`--env` → `PW_PERF_ENV`, `--passes` →
   `PW_PERF_PASSES`, `--prune` → `PW_PERF_PRUNE=1`, `--max-tests` → `PW_PERF_MAX_TESTS`). Remove
   the `perf:*` scripts an earlier wizard wrote to `package.json`. Thresholds come from a
   `PW_PERF_MODE=thresholds` run (the CI thresholds job and its artifact) instead of
   `thresholds --from`, and every run writes the HTML report, so `pw-perf report` has no
   replacement. See [Running](cli.md).
2. The guided setup takes no options: `PW_PERF_LANG=<code>`, `PW_PERF_DRY_RUN=1` and
   `PW_PERF_NO_TUTORIAL=1` replace `--lang`, `--dry-run` and `--no-tutorial`.
3. Remove `run.projects` from `pw-perf.config.*` (it is now `CONFIG_UNKNOWN_OPTION`). The
   measured projects are the ones your test command selects; add `--project chromium` to measure
   one browser engine.
4. Remove `--reporter` from the command you measure with (also inside an npm script): a test or
   thresholds run with it now stops with [`RUN_REPORTER_FLAG`](troubleshooting.md#run_reporter_flag)
   instead of measuring nothing.
5. `request` calls (API tests, data setup in UI tests) are now measured as keys such as
   `request GET /api/orders`. Until the next thresholds run (below) they are checked against the
   default thresholds ([Keys without an entry](thresholds.md#keys-without-an-entry)).

### From 0.1.0-next.3: endpoint and step keys changed

The built-in normalization changed (rules version 2 for URLs and for step titles):

- URL segments with a prefixed id, such as `ORD-1000` or `inv_58`, become `:id`
  (`keys.idPatterns.prefixed`).
- In step titles, numbers shorter than 9 digits become `:num` instead of `:id`, e.g.
  `Open order 4711` → `Open order :num`.

Every thresholds file gives `THRESHOLDS_SOURCE_MISMATCH` (normalization) until it is derived
again, and keys that contained such values give `THRESHOLDS_UNSEEN_ENTRIES`. To upgrade:

1. Run the thresholds job on CI and commit the new files; add `PW_PERF_PRUNE=1` to a thresholds run
   of the full suite to remove the old keys.
2. Update `measure.steps.include` / `exclude` patterns written against the old step keys
   (`Open order :id` → `Open order :num`).
3. To keep the old URL keys, set `keys: { idPatterns: { prefixed: false } }`. The step rule has
   no switch.

### From 0.1.0-next.3: report folder moved to `reports/pw-perf/`

The default `report.dir` is now `reports/pw-perf/` instead of `pw-perf-results/`; the files in it
are the same. To upgrade:

1. In `.gitignore`, replace `pw-perf-results/` with `reports/pw-perf/` (or keep `reports/` ignored).
2. In your CI jobs, replace `pw-perf-results` with `reports/pw-perf` in the artifact path and in
   the `outcome.json` path. The recipes in [CI](ci.md) name the artifact `pw-perf-report`.
3. Delete the old `pw-perf-results/` folder.

To keep the old folder instead, set `report: { dir: 'pw-perf-results' }` in `pw-perf.config.*`.
Only `report.dir` itself is emptied when a run starts, never the `reports/` folder around it.

### From 0.1.0-next.1 to 0.1.0-next.3: custom measurements removed

Custom measurements are gone. To upgrade:

1. Remove the calls of `perf.measure()`, `perf.start()`, `perf.end()`, `perf.sampleStart()` and
   `perf.sampleEnd()` from your tests and fixtures. Only `perf.track(context)` is left on the
   `perf` fixture; the old calls no longer type-check, and in JavaScript they throw a `TypeError`.
   Keep the measured code and drop only the wrapper call. To time a user-visible step, wrap it in
   `test.step()`; steps are measured by default (`measure.steps`).
2. Delete `pw-perf-thresholds.custom.json` (and `pw-perf-thresholds.custom.<env>.json`). The
   package no longer reads or writes these files.
3. Remove `custom` from `checks.*.*.limit`, `checks.errors.limit` and `checks.slowShare.t` in
   `pw-perf.config.*`; the option now fails with `CONFIG_UNKNOWN_OPTION`.
4. Nothing to do for the other files: thresholds files of version 1 and run reports of versions 1
   and 2 are still read (custom keys in old reports are dropped). Sample attachments are written
   and read by the same run, so they need no migration.

## Uninstalling

1. If your test files import from `playwright-performance-regression/test`, import from
   `@playwright/test` again.
2. Remove `withPerfFixtures(...)` around your test objects and the `trackContext()` /
   `perf.track()` calls.
3. In `playwright.config` remove `withPerf(...)` around the config and the `pw-perf.config`
   import.
4. Delete `pw-perf.config.*`, the `pw-perf-thresholds*.json` files, any `perf:*` scripts from an
   earlier wizard, the CI jobs you added (or an earlier wizard wrote) and the `reports/pw-perf/` line in `.gitignore`.
5. `npm uninstall playwright-performance-regression`.
