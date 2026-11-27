# CI

Ready recipes for four platforms are in [`examples/ci/`](../examples/ci). Copy the one for your
platform into the project: the guided setup (`npm init playwright-performance-regression`) does
not create CI jobs, it only points here at the end.

| Platform        | Recipe                                                      | Save as                                                                |
| --------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| GitHub Actions  | [`github-actions.yml`](../examples/ci/github-actions.yml)   | `.github/workflows/perf.yml`                                           |
| GitLab CI       | [`gitlab-ci.yml`](../examples/ci/gitlab-ci.yml)             | `.gitlab/perf.gitlab-ci.yml`, then `include:` it from `.gitlab-ci.yml` |
| Jenkins         | [`Jenkinsfile`](../examples/ci/Jenkinsfile)                 | `Jenkinsfile.perf`, as the script of its own pipeline job              |
| Azure Pipelines | [`azure-pipelines.yml`](../examples/ci/azure-pipelines.yml) | `azure-pipelines.perf.yml`, registered as its own pipeline             |

All recipes install dependencies with `npm ci` and run `npm run e2e`: replace it with your own test
command (e.g. `npm run e2e:qa`). The jobs run on Linux, so a command written for cmd or PowerShell
needs fixing there. In a pnpm or yarn project replace the install line (and `npx` with `pnpm exec`
or `yarn`).

## The recommended path

1. **Thresholds job, started by hand.** It runs your test command with `PW_PERF_MODE=thresholds`
   on the same runners that will measure (times from a laptop do not carry over) and uploads
   `reports/pw-perf/` as an artifact: the thresholds run copies the `pw-perf-thresholds*.json`
   files there, next to `thresholds-diff.md` (GitHub: Actions → Performance → Run workflow,
   mode `thresholds`; GitLab: the manual `perf-thresholds` job; Jenkins and Azure: the `MODE` /
   `mode` parameter).
2. **Commit the files.** Download the artifact (GitHub: `pw-perf-thresholds`; GitLab: the job
   artifacts; Jenkins: the archived `reports/pw-perf/`; Azure: `pw-perf-report`), review
   `thresholds-diff.md` and commit the thresholds files next to the Playwright config (or in
   `thresholds.dir`). Until they exist,
   measurement runs use the loose default thresholds.
3. **Measurement job, every week.** It runs with `PW_PERF_MODE=test` (cron `0 3 * * 1`; on GitLab
   create a weekly pipeline schedule) and can be started by hand. It fails on a regression.

Re-run the thresholds job after a deliberate change in performance or when the infrastructure
changes; review the diff before committing.

## What every recipe does

- **Sets `PW_PERF_MODE`** in the job environment and runs your usual test command, so its setup
  steps, variables and flags work as they are.
- **Installs Chromium** with its system libraries (`npx playwright install --with-deps chromium`).
  The measured projects are the ones your test command selects: if your config also has Firefox or
  WebKit projects, add `--project <name>` for the Chromium projects to the measurement command.
- **Reads the exit code from `reports/pw-perf/outcome.json`**: Playwright itself exits with 0 or 1,
  so the run step removes the file first, runs the command and exits with `exitCode` from the
  file (3 when it is missing: the measurement did not run).
- **Uploads `reports/pw-perf/` always**, also when the run fails, because that is when you need the
  report: GitHub `if: always()`, GitLab `artifacts: when: always`, Jenkins `post { always { ... } }`,
  Azure `condition: always()`. In the thresholds job this folder also holds the copies of the
  thresholds files, so no other path is uploaded.
- **Has a time limit** (60 minutes for measuring, 120 for thresholds, which use more passes).

## Not ready to block builds?

Set `continue-on-error: true` on the measurement job (GitLab: `allow_failure: true`, Jenkins:
`catchError(buildResult: 'SUCCESS')`, Azure: `continueOnError: true`). Violations still appear in
the log, the report and `outcome.json`. The package itself has no trial mode (`gate.warnOnly` was
removed); `gate.tolerance` and `gate.defaultThresholds: 'warn'` soften the gate permanently.

## Exit codes

| Code | Meaning                                       | Recipe behaviour                                                                                                                                           |
| ---- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | no blocking violation                         | job passes                                                                                                                                                 |
| 2    | performance regression                        | GitHub: job fails. GitLab: `allow_failure: exit_codes: 2` (warning). Jenkins: build `UNSTABLE`. Azure: the bash step turns 2 into "succeeded with issues". |
| 3    | tool or config error, or an untrustworthy run | job fails on every platform                                                                                                                                |

On Azure, `continueOnError` is not used on purpose: it would also soften code 3, which means the
measurement did not work. See [exit codes](cli.md#exit-codes) for all codes.

## Reading the result

- The job log contains the summary: verdict, counters, the violations table and the slowest
  sample of the first blocking keys.
- `reports/pw-perf/report.html` is a self-contained page: download the artifact and open it.
- `reports/pw-perf/report.json` is the machine-readable report.
- `reports/pw-perf/junit.xml` is the result in JUnit XML (see below).

Platform notes on the HTML report:

- **Jenkins:** `publishHTML` serves pages with a strict default Content Security Policy that also
  blocks the report's script and styles. The page still shows all data without them, but without
  layout, sorting and filters. Download the archived file instead, or relax the CSP for that
  page if your Jenkins administrators allow it.
- **Azure Pipelines** does not display HTML artifacts in the browser. Download the
  `pw-perf-report` artifact and open `report.html` locally.
- **GitHub Actions** and **GitLab CI** offer the artifact as a download.

## Test results in the CI (JUnit)

A measurement run (`PW_PERF_MODE=test`) also writes `reports/pw-perf/junit.xml`, and the recipes
publish it, so the result shows up next to your functional tests:

| Platform        | Where                                                                 | Recipe step                                                 |
| --------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| GitLab CI       | the pipeline's **Tests** tab and the merge request widget             | `artifacts: reports: junit:` in the `perf` job              |
| Jenkins         | **Test Result** of the build, and the JUnit trend chart               | `junit` in `post { always { ... } }`                        |
| Azure Pipelines | the **Tests** tab of the run                                          | `PublishTestResults@2`, in mode `test` only                 |
| GitHub Actions  | no test view of its own: the file is in the `pw-perf-report` artifact | an optional test report action, commented out in the recipe |

How to read it:

- There is one test per endpoint and step key, named exactly like its entry in the thresholds
  file, plus one test `measurement run` for the run as a whole.
- **A failed test means what exit code 2 or 3 means.** A key fails only on a blocking violation;
  `measurement run` has an error when the run had a tool error (exit code 3). The message shows
  the rule, the measured value, the limit and how much it is over, e.g.
  `p95 1500 ms > limit 1400 ms (+7%), 240 samples, thresholds file`.
- Violations that do not block (within `gate.tolerance`, default thresholds with
  `gate.defaultThresholds: 'warn'`) are passed tests with the violation in their output. Muted
  keys and keys with too few samples are skipped, with the reason.
- The test time of a key is its median.
- The job status still comes from `outcome.json` only: the recipes publish the file without
  letting it fail or mark the job (Jenkins `skipMarkingBuildUnstable: true`, Azure
  `failTaskOnFailedTests: false`).
- Thresholds runs and checks write no `junit.xml`; Jenkins allows empty results for
  `MODE=thresholds`, and Azure publishes only in mode `test`.

With your own [`report.dir`](configuration.md#reportdir), change the path in the recipe step. To
turn the file off, set [`report.junit`](configuration.md#reportjunit) to `false` (and remove the
step, or leave it: GitLab only warns about a missing file, Jenkins and Azure accept it).

## Sharded runs

A measurement run uses one worker and repeats the tests in passes, so a large suite can take
hours. When it no longer fits the time limit of a job (or the night), split it across machines
with Playwright's `--shard=i/n`, as you would a regular run, and add a merge job:

1. **Shard jobs** run your usual test command with `PW_PERF_MODE` and `--shard=i/n`. Each shard
   measures its part of the tests in all passes, does not evaluate and writes
   `reports/pw-perf/shard-<i>-of-<n>.json` and `outcome.json` (0, or 3 when its data are
   incomplete). The console ends with `Next: when all n shards are done, run PW_PERF_MODE=merge
npx pw-perf in the merge job`.
2. **The merge job** downloads the shard files of all shards to `reports/pw-perf/` and runs
   `PW_PERF_MODE=merge npx pw-perf`. It needs no browsers, only the checkout (with the thresholds
   files) and `npm ci`. It evaluates all samples as one run and writes one `report.json`,
   `report.html`, `junit.xml` and `outcome.json`; in mode `thresholds` it writes one complete set of
   thresholds files (copied to `reports/pw-perf/` for the artifact). It exits with 0, 2 or 3 like
   a run without shards; the summary says `merged from 4 shards`.

| Platform        | Recipe                                                                      |
| --------------- | --------------------------------------------------------------------------- |
| GitHub Actions  | [`sharded/github-actions.yml`](../examples/ci/sharded/github-actions.yml)   |
| GitLab CI       | [`sharded/gitlab-ci.yml`](../examples/ci/sharded/gitlab-ci.yml)             |
| Jenkins         | [`sharded/Jenkinsfile`](../examples/ci/sharded/Jenkinsfile)                 |
| Azure Pipelines | [`sharded/azure-pipelines.yml`](../examples/ci/sharded/azure-pipelines.yml) |

Each recipe has a shard job with a matrix of 4 machines, uploads only the `shard-*.json` files
(`outcome.json` and `pass-*.json` have the same names on every machine), keeps them for 7 days and
starts the merge job also when a shard failed, so that a missing shard is reported instead of
silently evaluating part of the keys. On GitLab the mode comes from the pipeline variable
`PERF_MODE`: a variable given when a pipeline is started overrides the job variables, so passing
`PW_PERF_MODE=thresholds` directly would also override `merge` in the merge job.

Rules for sharded runs:

- **The number of shards is in two places**: the matrix (or `parallel:`) and `--shard=i/n`. Keep
  them equal; shard files with different totals are rejected (`MERGE_SHARD_MISMATCH`).
- **Same machines.** Run all shards on the same machine type: differences between machines add
  noise (`MERGE_SHARDS_DIFFERENT_HOSTS`, with a table of the shards in the summary). Derive the
  thresholds with the same number of shards and machine type as the measurement.
- **Run the merge from the root of the checkout**, the directory where the shards ran the test
  command: it finds the Playwright config and the thresholds files from there
  (`MERGE_WRONG_DIRECTORY` otherwise). Use the same package version on every machine
  (`npm ci` from one lock file).
- **Every shard must upload its file, also when it failed.** A missing file is
  `MERGE_SHARD_MISSING` (exit code 3): the report covers the other shards, no thresholds files are
  written.
- `PW_PERF_ENV`, `PW_PERF_PRUNE` and `PW_PERF_PASSES` belong to the shard jobs; the merge uses the
  values of the shard files (`MERGE_ENV_IGNORED` when the merge job sets others).
- **With your own [`report.dir`](configuration.md#reportdir)** the shards write their files there,
  but the merge always reads and writes `reports/pw-perf/` of the working directory: download the
  shard files there.
- **Testing the merge locally:** run the shards one after another in separate copies of the
  project (a shard run empties `reports/pw-perf/` of its directory first), copy their
  `shard-*.json` files into `reports/pw-perf/` of one checkout and run
  `PW_PERF_MODE=merge npx pw-perf` there.

`PW_PERF_MODE=check` with `--shard` checks only the tests of that shard and writes no shard file.

## Isolation of the environment and the runner

Response times reflect everything that runs at the same time. Shared runners or a shared QA
environment loaded by other pipelines cause false alarms. Prefer:

- the same runner type for the thresholds run and the gate (derive thresholds there, see
  [Thresholds](thresholds.md#deriving-thresholds-the-recommended-flow));
- a dedicated or at least lightly loaded test environment;
- no other heavy jobs on the same machine during the run.

The reporter warns with `THRESHOLDS_SOURCE_MISMATCH` when the machine, browser or Playwright
version differs from the run the thresholds came from.
