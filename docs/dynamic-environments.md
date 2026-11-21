# Dynamic environments

Many suites are not started with a bare `npx playwright test`. An npm script sets variables,
prepares data and passes `--project` or `--grep`, and the application runs on a host that changes
per CI instance (`https://pr-4821.ci.example.com`). This page shows how to measure such a suite.

## Run your own script with one variable

```sh
PW_PERF_MODE=check npm run e2e:qa       # dry run: what is measured, how long a full run takes
PW_PERF_MODE=thresholds npm run e2e:qa  # derive the thresholds
PW_PERF_MODE=test npm run e2e:qa        # measure and compare
```

The variable is inherited by every process the script starts: npm (or pnpm, yarn), the shell of the
script, its setup steps and Playwright. So the script works as it always does: its variables, its
setup steps (`npm run prepare-env:qa && …`) and its Playwright flags stay. Arguments after `--`
reach Playwright as usual (`PW_PERF_MODE=test npm run e2e:qa -- --grep @perf`).

Things to know:

- Steps after Playwright in the script (`… && node upload-report.js`) run only when Playwright exits
  with 0. In a measurement run Playwright exits with 1 when the performance result is not 0, so such
  steps may be skipped; use a separate script without them.
- A script that sets `PW_PERF_MODE` itself (`"perf": "PW_PERF_MODE=test playwright test"`) wins over
  the variable you pass.
- A script that runs Playwright twice overwrites the report and `outcome.json`; the last run counts.
- Measurement scripts should not use `--last-failed`, `--only-changed`, `--workers`, `--ui` or
  `--reporter`: they change what is measured or replace the pw-perf reporter. The package warns
  about `--reporter` and `--ui` (see [troubleshooting](troubleshooting.md#run_reporter_flag)); prefer
  a separate measurement script.
- Projects whose tests only use the `request` fixture (API tests) measure nothing: requests made
  outside the browser are out of scope, and the run warns with
  [`RUN_PROJECT_NO_REQUESTS`](troubleshooting.md#run_project_no_requests). Leave them out with
  `run.projects`.
- Run the measurement in its own CI job, not in the job of the functional tests: it runs the tests
  several times on one worker.

On Windows prefix the command with `npx cross-env`; see [CLI](cli.md#run-through-your-own-test-command-recommended).

## baseURL from an environment module

When `use.baseURL` comes from a variable that the script sets, run the tests through that script.
Without it the URL may be empty or contain `undefined`
(`https://undefined.example.com`), and the run warns with
[`CONFIG_BASEURL_EMPTY`](troubleshooting.md#config_baseurl_empty).

## Random hosts per CI instance

Endpoint keys start with a label of the origin (the host of the backend). The origin of `baseURL`
gets the empty label, other hosts are labeled with their name:

```text
GET /api/session                          # origin of baseURL
GET api-pr-4821.ci.example.com/v1/catalog # another host
```

When the hosts change on every CI instance, the keys of the other hosts change too, and so does the
normalization fingerprint of the thresholds files (a new `baseURL` host is part of it), which
gives `THRESHOLDS_SOURCE_MISMATCH` on every run. Map the hosts with **host patterns** in
`keys.origins`:

```ts
// pw-perf.config.ts
export default definePerfConfig({
  keys: {
    origins: {
      'https://pr-*.ci.example.com': '', // the application: the main origin, like baseURL
      'https://api-pr-*.ci.example.com': 'api', // the backend: GET api/v1/catalog
    },
  },
});
```

Rules of a pattern:

- `<scheme>://<host>[:<port>]`, without a path; the scheme is `http` or `https`.
- `*` stands for at least one character inside one host label and never for a dot:
  `https://*.ci.example.com` matches `https://pr-4821.ci.example.com`, not
  `https://a.b.ci.example.com` or `https://ci.example.com`. One `*` per label.
- The top-level domain has no `*`, and at least one label is without `*` (`https://*` and
  `https://*.*` are rejected).
- A port must be the same: `https://app-*.example.com:8443` does not match port 443.
- An exact entry wins over a pattern; of several patterns the one with more literal characters
  wins.
- An empty label (`''`) makes the matching hosts the main origin, so random `baseURL` hosts give
  the same keys and the same fingerprint in every run.

Computing an exact entry from `process.env` in `pw-perf.config.ts`
(`{ [process.env.API_URL]: 'api' }`) works for the keys, but the host is part of the configuration,
so the fingerprint changes on every new host. Use a pattern for hosts that change.

## Before the first run

Run `PW_PERF_MODE=check npm run e2e:qa`. It runs the first test of each file once and shows the
projects, the origins with their labels, the top keys, an estimate of the full run and a hint with
host patterns when hosts look generated. Nothing is evaluated and no file is written.
