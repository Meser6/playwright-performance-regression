# playwright-performance-regression

Catch backend performance regressions from the Playwright tests you already have.

> **Pre-release.** `0.1.0-next.N` versions are published under the `next` tag: install with
> `npm init playwright-performance-regression@next` or
> `npm install --save-dev playwright-performance-regression@next`. Until `0.1.0`, the API, file
> formats and CLI may still change.

![HTML report of a measurement run](.github/assets/report.png)

## How it works

1. **Measures** the backend requests your browser makes while your existing e2e tests run, in a
   separate measurement run (`PW_PERF_MODE=test npm run e2e`): your test command runs a few times
   in a row (passes), and all passes are evaluated together.
2. **Groups** the requests into endpoint keys such as `GET /api/orders/:id`, and computes
   statistics per key: median, p95, p99, error rate and more.
3. **Derives thresholds** from a run and writes them to JSON files that you review and commit like
   code.
4. **Fails the run** when an endpoint gets slower or returns more errors than its thresholds
   allow, with a console summary and a self-contained HTML report.

Your normal `npx playwright test` runs are not changed.

## Install

```sh
npm init playwright-performance-regression@next
```

This installs the package as a dev dependency and starts a short guided setup (after `0.1.0`:
`npm init playwright-performance-regression`; run it again at any time). It shows a diff of every change
before writing anything: it wraps your Playwright config and your fixtures module, creates
`pw-perf.config.ts`, ignores `reports/pw-perf/` and can add the CI jobs. It never changes your test
files or `package.json`: when it cannot wrap your `test` object, it shows the code to paste. At the
end it runs a short check of what will be measured. `pnpm create` and
`yarn create` work too (Yarn 2 or later; Yarn 1 cannot install a specific version such as
`@next` with `yarn create`). The guided setup speaks English, Spanish, French, Polish, Italian,
Ukrainian and Russian (it asks at the start).

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
[Configuration](docs/configuration.md).

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
to `reports/pw-perf/report.json` and `reports/pw-perf/report.html`. All variables are described in
[Running](docs/cli.md).

Derive thresholds on the same machines that run the check, usually your CI runners (see
[CI](#ci) below); thresholds measured on a laptop do not fit CI. How much headroom they get is one
setting, `thresholds: { preset: 'strict' | 'normal' | 'loose' }`. See
[Thresholds](docs/thresholds.md).

## Step timings

Your existing `test.step` blocks are measured too, without changing the tests (on by default;
`measure: { steps: false }` in `pw-perf.config.ts` turns it off).

A step `submit` inside a step `login` becomes the key `login › submit`, with its own statistics,
checks and thresholds file `pw-perf-thresholds.steps.json`. Step titles are sanitized: ids,
e-mails, URLs and secrets never reach the keys or the reports, also inside quotes. See
[Step timings](docs/steps.md).

## CI

The recommended path: (1) a CI job you start by hand runs with `PW_PERF_MODE=thresholds` and keeps
the thresholds files as an artifact, (2) you commit them, (3) a weekly job runs with
`PW_PERF_MODE=test` and fails on a regression. In GitHub Actions, shortened:

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
        with: { name: pw-perf-thresholds, path: pw-perf-thresholds*.json }
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

- REST only: every GraphQL query goes to the same endpoint key.
- Only requests made by the browser are measured. Tests that use only the `request` fixture, and
  calls through `page.request` or `context.request`, record nothing.
- The projects your test command selects are measured (all without `--project`), except setup and
  teardown projects. Chromium is supported; Firefox and WebKit are best effort, so select one engine
  with `--project`.
- The measurement run is separate from your normal run, uses one worker and runs your test command
  several times (passes), so it is slow: measure a subset (`run: { grep: '@perf' }`, `--project`).
- The test command, with its setup steps, runs once per pass; tests that create data without such
  a step can collide in the next pass; make the data unique.
- A `--reporter` flag in the test command replaces the package reporter, so nothing is reported
  (the run warns with `RUN_REPORTER_FLAG`); keep reporters in `playwright.config` instead.

## Privacy

No telemetry. The package never makes network requests.

What ends up where:

- **Thresholds files and `report.json` / `report.html`** contain normalized endpoint keys: numbers,
  UUIDs, long hex strings, tokens, mixed-case ids and e-mail addresses in the path are replaced
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
