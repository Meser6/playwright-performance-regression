# CI

Ready recipes for four platforms are in [`examples/ci/`](../examples/ci). `pw-perf init` copies
the one for your platform into the project; you can also copy it by hand.

| Platform        | Recipe                                                      | Save as                                                                |
| --------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| GitHub Actions  | [`github-actions.yml`](../examples/ci/github-actions.yml)   | `.github/workflows/perf.yml`                                           |
| GitLab CI       | [`gitlab-ci.yml`](../examples/ci/gitlab-ci.yml)             | `.gitlab/perf.gitlab-ci.yml`, then `include:` it from `.gitlab-ci.yml` |
| Jenkins         | [`Jenkinsfile`](../examples/ci/Jenkinsfile)                 | `Jenkinsfile.perf`, as the script of its own pipeline job              |
| Azure Pipelines | [`azure-pipelines.yml`](../examples/ci/azure-pipelines.yml) | `azure-pipelines.perf.yml`, registered as its own pipeline             |

All recipes install dependencies with `npm ci`; in a pnpm or yarn project replace that line (and
`npx` with `pnpm exec` or `yarn`).

## What every recipe does

- **Triggers:** pull requests (merge requests) and a nightly schedule. A good split is a small
  tagged subset on pull requests and the full measured suite at night, e.g. `npx pw-perf test
--grep @perf` in the pull-request job and `npx pw-perf test` in the nightly one.
- **Installs Chromium** with its system libraries (`npx playwright install --with-deps chromium`).
- **Runs** `npx pw-perf test`.
- **Uploads `pw-perf-results/` always**, also when the run fails, because that is when you need the
  report: GitHub `if: always()`, GitLab `artifacts: when: always`, Jenkins `post { always { ... } }`,
  Azure `condition: always()`.
- **Has a time limit** (60 minutes), because a measurement run runs the tests in several passes.

## Exit codes

| Code | Meaning                                       | Recipe behaviour                                                                                                                                           |
| ---- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | no blocking violation                         | job passes                                                                                                                                                 |
| 2    | performance regression                        | GitHub: job fails. GitLab: `allow_failure: exit_codes: 2` (warning). Jenkins: build `UNSTABLE`. Azure: the bash step turns 2 into "succeeded with issues". |
| 3    | tool or config error, or an untrustworthy run | job fails on every platform                                                                                                                                |

On Azure, `continueOnError` is not used on purpose: it would also soften code 3, which means the
measurement did not work. See [CLI exit codes](cli.md#exit-codes) for all codes.

## Reading the result

- The job log contains the summary: verdict, counters, the violations table and the slowest
  sample of the first blocking keys.
- `pw-perf-results/report.html` is a self-contained page: download the artifact and open it.
- `pw-perf-results/report.json` is the machine-readable report, also the input of
  `pw-perf thresholds --from` (see [Thresholds](thresholds.md)) and `pw-perf report`.

Platform notes on the HTML report:

- **Jenkins:** `publishHTML` serves pages with a strict default Content Security Policy that also
  blocks the report's script and styles. The page still shows all data without them, but without
  layout, sorting and filters. Download the archived file instead, or relax the CSP for that
  page if your Jenkins administrators allow it.
- **Azure Pipelines** does not display HTML artifacts in the browser. Download the
  `pw-perf-results` artifact and open `report.html` locally.
- **GitHub Actions** and **GitLab CI** offer the artifact as a download.

## Isolation of the environment and the runner

Response times reflect everything that runs at the same time. Shared runners or a shared QA
environment loaded by other pipelines cause false alarms. Prefer:

- the same runner type for the thresholds run and the gate (derive thresholds there, see
  [Thresholds](thresholds.md#deriving-thresholds-the-recommended-flow));
- a dedicated or at least lightly loaded test environment;
- no other heavy jobs on the same machine during the run.

The reporter warns with `THRESHOLDS_SOURCE_MISMATCH` when the machine, browser or Playwright
version differs from the run the thresholds came from.

## Manual mode

If your CI cannot call `pw-perf`, set the mode variable yourself:

```sh
PW_PERF_MODE=test npx playwright test --grep @perf
```

The run measures and reports as usual, but without the CLI's guards: `--ui`, `--debug`, `--shard`
and `--prune` with a test filter are not refused (sharding is still detected by the reporter as
`RUN_SHARDED`), a `--reporter` flag replaces the package reporter, and the exit code is
Playwright's (1 for a failed gate or failed tests) instead of 0/2/3. Prefer `npx pw-perf test`
wherever possible.
