# Thresholds

Thresholds are the limits each endpoint key is checked against. They live
in JSON files in your repository and are reviewed and committed like code.

- [Files](#files)
- [Deriving thresholds: the recommended flow](#deriving-thresholds-the-recommended-flow)
- [When to derive](#when-to-derive)
- [Reviewing the diff](#reviewing-the-diff)
- [New and removed endpoints](#new-and-removed-endpoints)
- [Locked entries](#locked-entries)
- [Muting a flaky key](#muting-a-flaky-key)
- [Environments](#environments)
- [Hand-written entries](#hand-written-entries)
- [Keys without an entry](#keys-without-an-entry)

## Files

There is one file per kind and environment, in `thresholds.dir` (default: next to
`playwright.config`):

| File                                  | Contents                                                         |
| ------------------------------------- | ---------------------------------------------------------------- |
| `pw-perf-thresholds.json`             | backend requests, one entry per endpoint key                     |
| `pw-perf-thresholds.<env>.json`       | the same for an environment label, e.g. `staging`                |
| `pw-perf-thresholds.steps.json`       | `test.step` keys, with `measure.steps` on ([steps.md](steps.md)) |
| `pw-perf-thresholds.steps.<env>.json` | the same for an environment label                                |

An entry looks like this:

```json
"GET /api/orders/:id": {
  "maxErrorRate": 0.05,
  "maxWilson": 0.08,
  "median": 420,
  "minApdex": 0.86,
  "p99": 1300,
  "percentile": 760,
  "t": 500
}
```

`median`, `percentile` (the percentile chosen in `checks.time.percentile.level`, p95 by default)
and `p99` are limits in milliseconds. `t` is the Apdex threshold used by `minApdex` and `maxWilson`
(the allowed share of samples slower than `t`); they are `null` for keys too slow for a sensible
`t`. `maxErrorRate` is the allowed share of errors. The `generated` block at the top of the file
records which run the values came from (browser, Playwright version, machine, normalization). The
reporter warns with `THRESHOLDS_SOURCE_MISMATCH` when the current run differs from it.

## Deriving thresholds: the recommended flow

Derive thresholds on the same infrastructure that runs the gate, usually your CI runners, not on a
laptop. A laptop is faster or slower than CI in ways that have nothing to do with your backend,
and the limits would be wrong in both directions.

1. Run a thresholds run in CI, for example the manually triggered job of the
   [CI recipes](ci.md), which runs your test command with the variable:

   ```sh
   PW_PERF_MODE=thresholds npm run e2e
   ```

   It runs the measured tests (10 passes by default), never fails on violations, and writes the
   thresholds files, `pw-perf-results/report.json` and `pw-perf-results/thresholds-diff.md`.

2. Download the artifact of that job (the recipes keep the `pw-perf-thresholds*.json` files and
   `pw-perf-results/`).
3. Review the diff and commit the thresholds files.

Locally you can still run `PW_PERF_MODE=thresholds npm run e2e` to try the setup, but do not
commit limits measured on your machine.

Nothing is written when the run was interrupted, timed out, had tool errors or had too many
failed tests (`THRESHOLDS_SOURCE_INCOMPLETE`, `TESTS_FAILED_TOO_MANY`).

## When to derive

- On the main branch, after performance changes were merged, or on a schedule.
- In a pull request that changes performance on purpose (a new feature that is allowed to be
  slower, a faster query). The diff then shows the reviewers exactly which limits moved.

Do not re-derive just to make a red run green: that hides the regression the gate found.

Re-deriving does not rewrite every value. An existing entry keeps its limits when the new values
are within `thresholds.hysteresis` (10% for times) and still pass, so files only change where
performance really changed. With `thresholds.update: "new-only"` only keys without an entry are
added. A time limit that grows by more than `thresholds.loosenWarnRelative` (50%) is flagged with
`THRESHOLDS_LOOSENED_MUCH` and marked `!` in the diff.

## Reviewing the diff

Every thresholds run prints the diff per file and writes it as Markdown to
`pw-perf-results/thresholds-diff.md`, ready to paste into the pull request description. Each key is
listed as added, removed, loosened, tightened, mixed, unchanged, locked, unseen or skipped, with
the old and new limits.

## New and removed endpoints

- A new endpoint gets an entry on the next derivation. Until then it is checked against the
  default thresholds (see [Keys without an entry](#keys-without-an-entry)).
- An endpoint that no longer appears keeps its entry, so a run that measured only a subset does
  not delete the rest. The test run warns with `THRESHOLDS_UNSEEN_ENTRIES`. To remove such
  entries, derive from a run of the full measured suite with `PW_PERF_PRUNE=1`:

  ```sh
  PW_PERF_MODE=thresholds PW_PERF_PRUNE=1 npm run e2e
  ```

  Pruning is skipped with a test filter (`--grep`, `--project`, file names, ...) and the run warns
  with `RUN_PRUNE_SKIPPED`, because a filtered run would remove the entries of every test it did
  not run.

## Locked entries

Set `"locked": true` on an entry to pin it: derivation never changes or removes it. Use it for
limits that come from an agreement (an SLA, a product requirement) rather than from measurements.
Add a `note` explaining why.

```json
"POST /api/checkout": { "locked": true, "note": "SLA: 800 ms", "median": 800, "...": "..." }
```

## Muting a flaky key

When one key fails because of a known problem that someone is fixing, mute it instead of loosening
its limits:

```json
"GET /api/search?q": {
  "gate": "warn",
  "note": "Search index rebuild, JIRA-1234",
  "until": "2026-12-31",
  "median": 400,
  "...": "..."
}
```

`gate`, `note` and `until` are required together. Until the end of the `until` day (UTC) the key's
violations are warnings only, also above the hard limit (`THRESHOLDS_MUTED`). Seven days before
the end you get `THRESHOLDS_MUTE_EXPIRING`; after it the key blocks again and the run warns with
`THRESHOLDS_MUTE_EXPIRED`. Derivation keeps `gate`, `note` and `until` on recomputed entries.

Mute versus lock: a muted key keeps being measured and re-derived, and blocks again on a fixed
date; a locked entry keeps its limits forever and still blocks.

## Environments

When the same tests run against several environments (staging, a pre-production cluster), each
needs its own limits. Use an environment label:

```sh
PW_PERF_MODE=thresholds PW_PERF_ENV=staging npm run e2e
PW_PERF_MODE=test PW_PERF_ENV=staging npm run e2e
```

or `run.env` in the config. The label selects `pw-perf-thresholds.<kind>.staging.json`. A run with a
label never falls back to the file without a label; when the labelled file is missing it warns
with `THRESHOLDS_FILE_MISSING` and uses default thresholds (see
[Dynamic environments](dynamic-environments.md)).

## Hand-written entries

You can write entries by hand, also partial ones (for example only `median`). Missing limits are
taken from the config defaults when the key is evaluated, and derivation keeps a partial entry as
it is. A file without a `generated` block (`THRESHOLDS_MANUAL_FILE`) is fine.

## Keys without an entry

A key that has no entry is checked against the default limits from the config
(`checks.*.limit`, e.g. 2000 ms median for requests). With `gate.defaultThresholds: "block"` (the
default) these violations can fail the run; with `"warn"` they only warn. Without a thresholds
file a test-mode run warns with `THRESHOLDS_FILE_MISSING`, once for each kind that has keys in the
run; the thresholds run that creates the file does not.
