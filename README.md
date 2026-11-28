# playwright-performance-regression

Catch backend performance regressions from the Playwright tests you already have.

`playwright-performance-regression` is a Playwright Test reporter and fixture for **performance
regression testing in CI**. While your existing end-to-end (e2e) and API tests run, it measures
the **response time (latency) of every backend API endpoint** the browser calls, and the duration
of your `test.step` blocks. It computes median, p95 and p99 per endpoint, derives
**performance budgets (thresholds)** that you commit as JSON files, and fails the CI run when an
endpoint gets slower, returns more errors or starts failing fast. No new test scripts, no separate
performance suite, no network calls. It is not a load testing tool: it times the traffic your
functional tests already create.

![HTML report of a measurement run](.github/assets/report.png)

Live demo reports of an example project: [a slow endpoint and a fast failure](https://meser6.github.io/playwright-performance-regression/).

## How it works

1. **Measures** the backend requests your browser makes (and the `request` calls of API tests)
   while your existing e2e tests run, in a separate measurement run
   (`PW_PERF_MODE=test npm run e2e`): your test command runs a few times in a row (passes), and
   all passes are evaluated together.
2. **Groups** the requests into endpoint keys such as `GET /api/orders/:id`, and computes
   statistics per key: median, p95, p99, error rate and more.
3. **Derives thresholds** from a run and writes them to JSON files that you review and commit like
   code.
4. **Fails the run** when an endpoint gets slower, returns more errors or fails fast more often
   (a 401 in 8 ms instead of a 200 in 120 ms) than its thresholds allow, with a console summary
   and a self-contained HTML report.

Your normal `npx playwright test` runs are not changed.

## Features

- **API response time per endpoint**: requests are grouped into keys such as
  `GET /api/orders/:id` (ids, UUIDs and e-mails normalized), with median, p95, p99 and error rate
  per key; Playwright's `request` fixture is measured too ([Adoption](docs/adoption.md)).
- **`test.step` timings**: every step becomes a key like `login › submit`, with its own thresholds
  ([Step timings](docs/steps.md)).
- **Thresholds from a real run**: a thresholds run writes `pw-perf-thresholds*.json` with headroom
  (`strict`, `normal`, `loose`), a diff to review, locking and muting of single keys
  ([Thresholds](docs/thresholds.md)).
- **Regression gate**: rules for slower p95 and median, more errors and more non-success
  responses, with exit code 2 for a performance regression ([Running](docs/cli.md#exit-codes)).
- **Fast failures**: an endpoint that answers 401, 403, 404 or 5xx in a few milliseconds instead
  of 200 fails the `nonSuccess` rule instead of looking faster
  ([Fast failures](docs/thresholds.md#fast-failures-and-workload-changes)).
- **Cold start handling**: the first call of each endpoint per pass (cold cache, container
  spin-up) stays out of p95 ([`measure.coldSamples`](docs/configuration.md#measurecoldsamples)).
- **Workload context**: each result is compared with the number of samples of the thresholds run,
  so a test that now calls an endpoint less often is flagged, not mistaken for a speed-up.
- **GraphQL and tRPC**: a key per GraphQL operation (`POST /graphql#GetTickets`) or tRPC procedure
  ([Operations](docs/configuration.md#operations)).
- **Sharding**: measure with Playwright's `--shard` on several CI machines and merge the shards
  into one report ([Sharded runs](docs/ci.md#sharded-runs)).
- **Reports**: console summary, self-contained HTML report, `report.json` and `junit.xml` for CI
  test views ([CI](docs/ci.md#test-results-in-the-ci-junit)).
- **CI recipes** for GitHub Actions, GitLab CI, Jenkins and Azure Pipelines ([CI](docs/ci.md)).
- **Private by default**: no telemetry, no network requests, normalized URLs ([Privacy](#privacy)).

## When to use it

Use it when you want to know that a backend change made the API slower, and you already have
Playwright tests that exercise that API: it turns them into a performance check without writing a
second test suite.

Use something else for load or stress testing (many concurrent users), for frontend metrics such
as Core Web Vitals or Lighthouse scores, and for monitoring production traffic. See
[Is this a load test?](docs/faq.md#is-this-a-load-test)

## Install

```sh
npm init playwright-performance-regression
```

This installs the package as a dev dependency and starts a short guided setup (run it again at
any time; in a project with the package installed, `npx pw-perf` starts it too). It asks which tests to measure, the passes, what
to measure (endpoints, `test.step` blocks or both), the threshold headroom and your usual test
command, then shows a diff of every change before writing it: it creates `pw-perf.config.ts`
(`pw-perf.config.js` in a JavaScript project) with the most important options, wraps your
Playwright config and your fixtures module, ignores `reports/pw-perf/`. It adds no CI jobs and no scripts: your
test command is only used in the commands it prints at the end and for the check; the
[CI recipes](docs/ci.md) are yours to copy.
Without a fixtures module, it switches the `@playwright/test` imports of your test files to
`playwright-performance-regression/test`, one confirmed diff per file; when it cannot change the
test object, it shows the code to paste. `package.json` is never changed. At the end it offers a
check: your test command runs with `PW_PERF_MODE=thresholds`, then `PW_PERF_MODE=test`, both with
2 passes, and the check's thresholds files are deleted afterwards. It ends with an IMPORTANT box
of the next steps: thresholds on CI (can take several hours), download, commit, then
`PW_PERF_MODE=test`. `pnpm create` and `yarn create`
work too. The guided setup speaks English, Spanish, French, Polish, Italian, Ukrainian and
Russian (it asks at the start). It takes no arguments; `PW_PERF_LANG`, `PW_PERF_DRY_RUN` and
`PW_PERF_NO_TUTORIAL` change it ([Guided setup](docs/cli.md#guided-setup)).

<details>
<summary>Manual setup</summary>

```sh
npm install -D playwright-performance-regression
```

Wrap the Playwright config:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import { withPerf } from 'playwright-performance-regression/config';

export default withPerf(defineConfig({/* your config, unchanged */}));
```

Then either wrap your own test object:

```ts
// fixtures.ts
import { test as base } from '@playwright/test';
import { withPerfFixtures } from 'playwright-performance-regression/fixture';

export const test = withPerfFixtures(base.extend({/* your fixtures */}));
export { expect } from '@playwright/test';
```

or, if your tests import `test` straight from `@playwright/test`, switch that import:

```ts
import { test, expect } from 'playwright-performance-regression/test';
```

Optionally add `pw-perf.config.ts` and pass it as the second argument of `withPerf()`; see
[Configuration](docs/configuration.md). Remove `--reporter` from the command you measure with:
it replaces the package reporter, so a measurement run stops with `RUN_REPORTER_FLAG`.

</details>

Projects with their own fixtures, several test objects, `mergeTests`, playwright-bdd, config
wrappers or custom reporters: see [Adopting the package in an existing project](docs/adoption.md).

## Quick start

Run your usual test command with `PW_PERF_MODE` in front of it. `npm run e2e` stands for your own
script, or `npx playwright test`:

```sh
PW_PERF_MODE=check npm run e2e        # dry run: what is measured and how long a run takes
PW_PERF_MODE=thresholds npm run e2e   # measure and write the thresholds files
git add pw-perf-thresholds*.json && git commit -m "test: add performance thresholds"
PW_PERF_MODE=test npm run e2e         # measure again and compare with the thresholds
```

On Windows: `npx cross-env PW_PERF_MODE=test npm run e2e` (PowerShell and cmd forms in
[docs/cli.md](docs/cli.md)). Without the variable the tests run as before, with no measuring.

The exit code is Playwright's own; the cause of a failure (a regression, failed tests, a config
error) is in `reports/pw-perf/outcome.json`. The result is also printed in the terminal and written
to `reports/pw-perf/report.json` and `reports/pw-perf/report.html` (tabs Overview, Endpoints,
Steps, Tests and Run & config); a `test` run also writes `reports/pw-perf/junit.xml` for the test
views of CI systems. Every `test` and `thresholds` run empties `reports/pw-perf/` first,
so it holds only the last run. All variables are described in [Running](docs/cli.md).

Derive thresholds on the same machines that run the check, usually your CI runners (see
[CI](#ci) below); thresholds measured on a laptop do not fit CI. How much headroom they get is one
setting, `thresholds: { preset: 'strict' | 'normal' | 'loose' }`. See
[Thresholds](docs/thresholds.md).

## Step timings

Your existing `test.step` blocks are measured too, without changing the tests (on by default;
`measure: { steps: false }` in `pw-perf.config.ts` turns it off, `measure: { api: false }` measures
only the steps).

A step `submit` inside a step `login` becomes the key `login › submit`, with its own statistics,
checks and thresholds file `pw-perf-thresholds.steps.json`. Step titles are sanitized: ids,
e-mails, URLs and secrets never reach the keys or the reports, also inside quotes; numbers in
words become `:num` (`Transfer 1500 PLN` → `Transfer :num PLN`). See [Step timings](docs/steps.md).

## CI

The recommended path: (1) a CI job you start by hand runs with `PW_PERF_MODE=thresholds` and keeps
`reports/pw-perf/` as an artifact (the run copies the thresholds files there), (2) you commit the
thresholds files, (3) a weekly job runs with `PW_PERF_MODE=test` and fails on a regression. In
GitHub Actions, shortened:

```yaml
name: Performance
on:
  schedule:
    - cron: '0 3 * * 1'
  workflow_dispatch:
    inputs:
      mode: { type: choice, options: [test, thresholds], default: test }
jobs:
  thresholds:
    if: inputs.mode == 'thresholds'
    runs-on: ubuntu-latest
    env: { PW_PERF_MODE: thresholds }
    steps:
      - uses: actions/checkout@v7
      - run: npm ci && npx playwright install --with-deps chromium
      - run: npm run e2e
      - uses: actions/upload-artifact@v7
        if: always()
        with: { name: pw-perf-thresholds, path: reports/pw-perf/ }
  measure:
    if: github.event_name == 'schedule' || inputs.mode == 'test'
    runs-on: ubuntu-latest
    env: { PW_PERF_MODE: test }
    steps:
      - uses: actions/checkout@v7
      - run: npm ci && npx playwright install --with-deps chromium
      - run: npm run e2e
      - uses: actions/upload-artifact@v7
        if: always() # the report matters most when the run fails
        with: { name: pw-perf-report, path: reports/pw-perf/ }
```

Not ready to block builds yet? Set `continue-on-error: true` on the measure job. The full recipes
for GitHub Actions, GitLab CI, Jenkins and Azure Pipelines read the exact exit code (**0** ok,
**2** performance regression, **3** tool or config error) from `reports/pw-perf/outcome.json`:
[CI](docs/ci.md).

## Limitations

- Keys come from the method and the URL. GraphQL and tRPC endpoints get a key per operation or
  procedure only when you list them in `keys.operations`; otherwise every GraphQL query shares
  one key ([Operations](docs/configuration.md#operations)).
- Requests made by the browser and calls of Playwright's `request` fixture, `page.request` and
  `context.request` are measured (keys such as `request GET /api/orders/:id`, separate from the
  browser's); other HTTP clients (Node `fetch`, axios) are not. API tests are measured only when
  they import `test` from the wrapped test object, and contexts from `request.newContext()` only
  after `trackRequestContext(context)` ([Adoption](docs/adoption.md)).
- The projects your test command selects are measured (all without `--project`), except setup and
  teardown projects. Chromium is supported; Firefox and WebKit are best effort, so select one engine
  with `--project`.
- The measurement run is separate from your normal run, uses one worker and runs your test command
  several times (passes), so it is slow: measure a subset (`run: { grep: '@perf' }`, `--project`),
  or split it across machines with `--shard` and merge the shards in one job
  ([Sharded runs](docs/ci.md#sharded-runs)).
- The test command, with its setup steps, runs once per pass; tests that create data without such
  a step can collide in the next pass; make the data unique.
- A `--reporter` flag in the test command replaces the package reporter, so nothing is reported
  (a test or thresholds run stops with `RUN_REPORTER_FLAG`); keep reporters in
  `playwright.config` instead.

## Privacy

No telemetry. The package never makes network requests.

What ends up where:

- **Thresholds files and `report.json` / `report.html`** contain normalized endpoint keys: numbers,
  UUIDs, long hex strings, tokens, mixed-case ids, prefixed ids (`ORD-1000`, `inv_58`) and e-mail addresses in the path are replaced
  with `:id` or `:email`, and query values are dropped (only parameter names stay). Path segments
  that match none of these patterns, such as user names, stay in the key; add patterns with
  `keys.extraIdPatterns`. The report also contains test titles, file names, the operating system, CPU model
  and CI metadata (commit, branch, build URL).
- **Raw URLs** go into the report only when you set `report.rawUrls: true`.
- **Playwright's own report** gets one attachment per test with the full URLs of the measured
  requests.

**Before you share a report** outside your team, check the keys for personal data and remember
that Playwright's HTML report and traces contain the full URLs.

## Compatibility

|                   | Supported                                                                     |
| ----------------- | ----------------------------------------------------------------------------- |
| Node.js           | 22.18 or newer (22, 24, 26)                                                   |
| Playwright Test   | 1.57 or newer (`@playwright/test` is a peer dependency)                       |
| Operating systems | Linux, macOS, Windows                                                         |
| Browsers          | Chromium (including Chrome and Edge channels); Firefox and WebKit best effort |
| Module formats    | ESM and CommonJS configs; TypeScript configs loaded by Playwright             |

## Upgrading

Since `1.0.0`, a newer version reads and migrates the files of older versions, so upgrading
changes nothing you have to fix by hand. The other direction does not work: an older version refuses files written by
a newer one with `SCHEMA_VERSION_TOO_NEW` (for example, `1.0.x` refuses the thresholds files that
`1.1.0` writes). Upgrade every machine and CI job that reads the thresholds files at the same time,
before you commit new thresholds files. Steps per release:
[Upgrading](docs/upgrading.md#from-10x-to-110).

## Documentation

- [Configuration](docs/configuration.md): every option with its default
- [Running](docs/cli.md): variables, the guided setup and exit codes
- [Adoption](docs/adoption.md): existing projects, choosing tests, sample counts
- [Thresholds](docs/thresholds.md): deriving, reviewing, locking and muting
- [Step timings](docs/steps.md): measuring `test.step` blocks, keys and title sanitization
- [Dynamic environments](docs/dynamic-environments.md): npm scripts with setup steps, random CI hosts and host patterns
- [CI](docs/ci.md): recipes for GitHub Actions, GitLab CI, Jenkins and Azure Pipelines
- [Troubleshooting](docs/troubleshooting.md): every warning and error code
- [FAQ](docs/faq.md) · [Upgrading and uninstalling](docs/upgrading.md)
- [Examples](examples): a basic project and one with setup projects and own fixtures

## Security

Please report vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/Meser6/playwright-performance-regression/security/advisories/new),
not in public issues.

## Contributing

Issues and pull requests are welcome. The project uses pnpm, Conventional Commits and squash
merges; `pnpm lint`, `pnpm typecheck` and `pnpm test` (after `pnpm build`) must pass. Releases
follow [RELEASING.md](RELEASING.md).

## License

[MIT](LICENSE)
