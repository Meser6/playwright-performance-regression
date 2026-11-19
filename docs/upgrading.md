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

## Uninstalling

1. Undo the import swap: in the test files replace `playwright-performance-regression/test` with
   `@playwright/test`.
2. Remove `withPerfFixtures(...)` around your test objects and `trackContext()` / `perf.track()`
   calls, and any `perf.measure()` / `perf.start()` / `perf.end()` calls (or keep the measured code
   and drop only the wrapper call).
3. In `playwright.config` remove `withPerf(...)` around the config and the `pw-perf.config`
   import.
4. Delete `pw-perf.config.*`, the `perf-thresholds.*.json` files, the `perf:test` and
   `perf:thresholds` scripts, the CI job and the `perf-results/` line in `.gitignore`.
5. `npm uninstall playwright-performance-regression`.
