# CI

Ready recipes for four platforms are in [`examples/ci/`](../examples/ci). The guided setup
(`npm init playwright-performance-regression`) copies the one for your platform into the project;
you can also copy it by hand.

| Platform        | Recipe                                                      | Save as                                                                |
| --------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| GitHub Actions  | [`github-actions.yml`](../examples/ci/github-actions.yml)   | `.github/workflows/perf.yml`                                           |
| GitLab CI       | [`gitlab-ci.yml`](../examples/ci/gitlab-ci.yml)             | `.gitlab/perf.gitlab-ci.yml`, then `include:` it from `.gitlab-ci.yml` |
| Jenkins         | [`Jenkinsfile`](../examples/ci/Jenkinsfile)                 | `Jenkinsfile.perf`, as the script of its own pipeline job              |
| Azure Pipelines | [`azure-pipelines.yml`](../examples/ci/azure-pipelines.yml) | `azure-pipelines.perf.yml`, registered as its own pipeline             |

All recipes install dependencies with `npm ci` and run `npm run e2e`; the guided setup writes the
recipe with your own test command (e.g. `npm run e2e:qa`). In a pnpm or yarn project replace the
install line (and `npx` with `pnpm exec` or `yarn`).

## The recommended path

1. **Thresholds job, started by hand.** It runs your test command with `PW_PERF_MODE=thresholds`
   on the same runners that will measure (times from a laptop do not carry over) and keeps the
   `pw-perf-thresholds*.json` files as an artifact (GitHub: Actions → Performance → Run workflow,
   mode `thresholds`; GitLab: the manual `perf-thresholds` job; Jenkins and Azure: the `MODE` /
   `mode` parameter).
2. **Commit the files.** Download the artifact and commit the thresholds files. Until they exist,
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
- **Reads the exit code from `pw-perf-results/outcome.json`**: Playwright itself exits with 0 or 1,
  so the run step removes the file first, runs the command and exits with `exitCode` from the
  file (3 when it is missing: the measurement did not run).
- **Uploads `pw-perf-results/` always**, also when the run fails, because that is when you need the
  report: GitHub `if: always()`, GitLab `artifacts: when: always`, Jenkins `post { always { ... } }`,
  Azure `condition: always()`. The thresholds job also uploads `pw-perf-thresholds*.json`.
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
- `pw-perf-results/report.html` is a self-contained page: download the artifact and open it.
- `pw-perf-results/report.json` is the machine-readable report.

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
