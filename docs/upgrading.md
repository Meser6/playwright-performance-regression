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
  remove old keys with `--prune`.

After upgrading, run `npx pw-perf thresholds --from <a recent report.json>` and review the diff
before committing anything.

### From 0.1.0-next.1 to 0.1.0-next.2: custom measurements removed

Custom measurements are gone. To upgrade:

1. Remove the calls of `perf.measure()`, `perf.start()`, `perf.end()`, `perf.sampleStart()` and
   `perf.sampleEnd()` from your tests and fixtures. Only `perf.track(context)` is left on the
   `perf` fixture; the old calls no longer type-check, and in JavaScript they throw a `TypeError`.
   Keep the measured code and drop only the wrapper call. To time a user-visible step, wrap it in
   `test.step()` and turn on `measure.steps`.
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
   earlier wizard, the CI jobs and the `pw-perf-results/` line in `.gitignore`.
5. `npm uninstall playwright-performance-regression`.
