# Adopting the package in an existing project

This page is for projects that already have a Playwright suite with their own fixtures, config
helpers, reporters or several test objects. For a new or simple project, `npm init
playwright-performance-regression` (see the [README](../README.md#install)) does everything below
for you.

- [The two changes](#the-two-changes)
- [Situation → what to do](#situation--what-to-do)
- [What the guided setup changes by itself](#what-the-guided-setup-changes-by-itself)
- [Choosing the tests to measure](#choosing-the-tests-to-measure)
- [Start without blocking builds](#start-without-blocking-builds)
- [Threshold headroom](#threshold-headroom)
- [Settings in test files win](#settings-in-test-files-win)
- [Long polling, streaming and server-sent events](#long-polling-streaming-and-server-sent-events)
- [Tests that create data](#tests-that-create-data)
- [Mocked routes](#mocked-routes)
- [Monorepos](#monorepos)
- [CommonJS configs](#commonjs-configs)
- [What a request time includes](#what-a-request-time-includes)

## The two changes

The package needs two things in your project:

1. `playwright.config` is wrapped in `withPerf()`. Outside a measurement run this returns your
   config object unchanged; inside one it switches to one worker, runs every test once per pass
   (`repeatEach: 1`; the reporter runs your test command once per pass) and adds the package
   reporter.
2. The `test` object your browser tests use is wrapped in `withPerfFixtures()` (or the tests
   import the ready `test` from `playwright-performance-regression/test`). Outside a measurement
   run this only adds the `perf` fixture; Playwright's `page` and `context` are left alone.

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import { withPerf } from 'playwright-performance-regression/config';
import perfConfig from './pw-perf.config';

export default withPerf(defineConfig({/* unchanged */}), perfConfig);
```

```ts
// fixtures.ts
import { test as base } from '@playwright/test';
import { withPerfFixtures } from 'playwright-performance-regression/fixture';

export const test = withPerfFixtures(base.extend<MyFixtures>({/* your fixtures */}));
export { expect } from '@playwright/test';
```

The second argument of `withPerf()` is optional; see [Configuration](configuration.md).

## Situation → what to do

| Situation in your project                                                            | What to do                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tests import `test` directly from `@playwright/test`                                 | Replace the import with `import { test, expect } from 'playwright-performance-regression/test'` (search and replace in the test folder).                                                                                                           |
| Own `fixtures.ts` with `base.extend(...)`                                            | `export const test = withPerfFixtures(base.extend(...))`: wrap the last step of the `extend` chain.                                                                                                                                                |
| Own `context` override that uses the base `context`                                  | Nothing. The package's override builds on it as long as `withPerfFixtures()` is the last step.                                                                                                                                                     |
| Own `context` or `page` fixture created with `browser.newContext()`                  | Nothing. The package's `page` override attaches to the page's context. A context without a page in the test: call `perf.track(context)`.                                                                                                           |
| Role fixtures (`adminPage`, `userPage`) on their own contexts                        | Add them after `withPerfFixtures()` and call `perf.track(context)` right after creating each context.                                                                                                                                              |
| Logged-in context with worker scope, or a page from `beforeAll` in `describe.serial` | Call `trackContext(context)` from `playwright-performance-regression/fixture` right after creating it.                                                                                                                                             |
| `mergeTests(a, b)`                                                                   | Wrap the merged object: `withPerfFixtures(mergeTests(a, b))`.                                                                                                                                                                                      |
| Several test objects (`test`, `adminTest`, ...)                                      | Wrap every object used by browser tests. An object derived from an already wrapped one is measured already; wrapping it again changes nothing.                                                                                                     |
| playwright-bdd                                                                       | Wrap the `test` you pass to `createBdd()`: `createBdd(withPerfFixtures(test))`, where `test` comes from `playwright-bdd` (or extends it). The generated files import it from your steps file.                                                      |
| API-only tests (only the `request` fixture)                                          | Wrapping is optional: `request` calls are not measured. Unwrapped tests in a measured project are reported as `TESTS_NOT_INSTRUMENTED`, so wrapping them is still recommended (they get an empty attachment).                                      |
| Login (`setup`) project used as a dependency                                         | Nothing. Dependencies and teardown projects run once and are not measured.                                                                                                                                                                         |
| Another wrapper around the Playwright config                                         | Make `withPerf()` the outermost call: `withPerf(otherWrapper(defineConfig({...})), perfConfig)`. If the other wrapper must be outside and changes workers, retries or repetitions, the run still measures and warns with `RUN_CONDITIONS_CHANGED`. |
| Own reporters (TestRail, Xray, Allure, Slack, JUnit)                                 | They are switched off in measurement runs. Keep the ones you need with `run.keepReporters`, e.g. `['junit']`.                                                                                                                                      |
| Firefox and WebKit projects in the config                                            | The projects your test command selects are measured (all without `--project`), so select one engine with `--project`, e.g. `--project chromium`.                                                                                                   |
| `page.route()` mocks                                                                 | Mocked requests are measured like real ones. Exclude them with `measure.exclude` (see [Mocked routes](#mocked-routes)).                                                                                                                            |
| Tests that create data                                                               | Repeated runs may collide; see [Tests that create data](#tests-that-create-data).                                                                                                                                                                  |

Every row is exercised by an integration project in this repository
(`test/integration/projects/`).

Order matters for `context` overrides: the package's override must be the last one. If a
fixture overrides `context` after `withPerfFixtures()` without using the base `context`, the
package's `context` override never runs; the `page` override still finds the page's context and
reports the informational diagnostic `COLLECTOR_CONTEXT_AUTO_TRACKED`. Keep `withPerfFixtures()`
last to avoid that.

## What the guided setup changes by itself

The guided setup (`npm init playwright-performance-regression`) reads your project as text and changes only layouts it recognises. It never changes
your test files or `package.json`. Everything else is printed as an `INIT_MANUAL_STEP` instruction
from the table above, or, for the test object, as a red box with the code to paste
(`INIT_TEST_OBJECT_MANUAL`).

| File                  | Recognised layout                                                                                                                                                           | Change                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `playwright.config.*` | `export default defineConfig({...})`, `export default {...}`, `module.exports = defineConfig({...})` or `module.exports = {...}` as the last statement                      | wraps it in `withPerf(..., perfConfig)` and adds the imports (CommonJS: `require('./pw-perf.config').default`)                             |
| fixtures module       | exactly one `.extend(` call in the project (not `expect.extend`), written as `export const test = X.extend(...)` or `exports.test = X.extend(...)`, in a file without tests | wraps it in `withPerfFixtures(...)`                                                                                                        |
| test files            | never changed                                                                                                                                                               | when the tests import `test` from `@playwright/test`, the wizard shows the import to use instead: `playwright-performance-regression/test` |
| `pw-perf.config.ts`   | missing                                                                                                                                                                     | created with the 15 most important options: the answers that differ from the defaults as code, the others commented out with their default |
| `.gitignore`          | any                                                                                                                                                                         | adds `pw-perf-results/`                                                                                                                    |
| `package.json`        | never changed                                                                                                                                                               | the wizard shows the commands with `PW_PERF_MODE` before your test command                                                                 |
| CI                    | GitHub Actions, GitLab CI, Jenkins or Azure Pipelines detected                                                                                                              | adds a separate file from [the CI recipes](ci.md): a manual thresholds job and a weekly measurement job running your test command          |

Not recognised, so left to you: other config wrappers, several test objects, `mergeTests`, a
`.json` package config, and existing CI files with other content. Running `init` again
changes nothing that is already set up.

## Choosing the tests to measure

A measurement run executes every measured test several times in one worker, so it is much slower
than your normal suite. `init` measures all tests by default; to measure a subset, tag a few representative tests with
`@perf` and set `run: { grep: '@perf' }` in `pw-perf.config.ts` (answering `@perf` in `init` does
this); it applies only in perf mode, to the measured projects, so setup projects still run in
full. You can also select projects with `--project` in the measurement command: setup and
teardown projects are never measured. Good candidates load the main
pages and call the endpoints you care about; tests that mostly wait for timers or animations add
time without useful samples.

The number of samples per endpoint decides which checks run. For each endpoint key:

```text
samples = calls per test × tests that call it × repetitions
```

| Check             | Minimum successful samples (default)              |
| ----------------- | ------------------------------------------------- |
| median            | 5                                                 |
| error rate        | 5                                                 |
| percentile (p95)  | 20                                                |
| apdex, slow share | 20 (and an entry with `t` in the thresholds file) |
| p99               | 100                                               |

Example: an endpoint called once by 2 tests with the default 5 passes has 10 samples, so the
median and error-rate checks run and the p95 check is skipped. With 2 tests and
`PW_PERF_PASSES=10` it reaches 20 samples and p95 is checked too. A key below a check's minimum is reported as "median
only" or "not evaluated" instead of failing; see [FAQ](faq.md#why-do-most-keys-have-too-few-samples-or-are-evaluated-by-median-only).

Rough run time: `passes × (measured tests × average test time + setup)`: the setup projects and
the steps of your test script run once per pass. With 20 tests of 6 s and 5 passes that is about
10 minutes on one worker. A thresholds run uses 10 passes by default (`run.passes.thresholds`),
so it takes about twice as long. The start banner of every run shows an estimate.

## Start without blocking builds

For the first weeks, let the measurement job report without failing the pipeline: set
`continue-on-error: true` on the job (GitHub Actions; GitLab `allow_failure: true`, Jenkins
`catchError`, Azure `continueOnError: true`). Violations still appear in the summary, the report
and `outcome.json`. Once the thresholds are stable on your CI runners, remove it. Inside the
package, `gate.tolerance` (a number of keys or a share like `"5%"`) and
`gate.defaultThresholds: 'warn'` soften the gate for good; a single key can be muted in the
thresholds file (`gate: "warn"` with `note` and `until`, see [Thresholds](thresholds.md)).

## Threshold headroom

Derived thresholds are the times of a thresholds run plus headroom. `thresholds.preset` sets the
headroom of every rule at once:

| Preset   | Headroom of median and percentile limits | For                                                         |
| -------- | ---------------------------------------- | ----------------------------------------------------------- |
| `strict` | +25%, at least 50 ms                     | stable, dedicated environments; catches smaller regressions |
| `normal` | +40%, at least 100 ms (default)          | a good start                                                |
| `loose`  | +60%, at least 200 ms                    | shared or noisy environments; only clear regressions        |

Fields set in `checks.*.margin` win over the preset. See [Configuration](configuration.md).

## Settings in test files win

`withPerf()` sets workers, `repeatEach`, trace, video and screenshots in the config. Values set in
test files with `test.use()` (for example `trace: 'on'` or `video`) are applied by Playwright
after the config and win. The run still measures, and the reporter warns with
`RUN_CONDITIONS_CHANGED` when it sees trace and video attachments. Remove those settings for the
measured tests, or guard them with `process.env.PW_PERF_MODE === undefined`.

`retries` are not changed: the value of your Playwright config (or of
`test.describe.configure({ retries })`) applies in perf mode too. Every attempt is measured, and a
test that passes on a retry counts as passed (flaky).

## Long polling, streaming and server-sent events

At the end of each test the collector waits up to `measure.pendingTimeoutMs` (2 s by default) for
requests still in flight. A long poll or a streamed response that never ends uses that whole wait
in every test and is then recorded as `PENDING`, which counts as an error by default, and the run
warns with `COLLECTOR_REQUESTS_PENDING`. Exclude such endpoints:

```ts
import { definePerfConfig, perfDefaults } from 'playwright-performance-regression';

export default definePerfConfig({
  measure: { exclude: [...perfDefaults.measure.exclude, '/api/notifications/poll', '/events'] },
});
```

`EventSource` requests are not measured by default (`measure.resourceTypes` contains `document`,
`xhr` and `fetch`), and WebSocket traffic cannot be measured at all.

## Tests that create data

The test command runs once per pass, with everything your script does before Playwright: a script
like `"e2e": "node seed.mjs && playwright test"` seeds the data again before every pass. A test
that creates a user with a fixed e-mail, or an order with a fixed number, without such a step can
fail in the second pass. Reset the data in the script, make created data unique (a random suffix)
or clean it up in the test. A pass whose setup step fails gives `RUN_PASS_FAILED` and the other
passes are evaluated. A few failed executions only give a `TESTS_FAILED` warning; above `gate.maxFailedTestShare` (10% by
default) the run ends with `TESTS_FAILED_TOO_MANY` because the numbers cannot be trusted.

## Mocked routes

Requests answered by `page.route()` with `route.fulfill()` never reach your backend, but the
browser still reports them, so they appear as endpoint keys with near-zero times. Exclude their
URLs with `measure.exclude`, or keep tests that rely on mocks out of the measured subset.

## Monorepos

Run the measurement where you run the app's tests, with the variable in front of the usual
command, for example from the repository root:

```sh
PW_PERF_MODE=test npx playwright test -c apps/web/playwright.config.ts
PW_PERF_MODE=test pnpm --filter web run e2e
```

Relative paths in the package config (`report.dir`, `thresholds.dir`) are relative to the
Playwright config's directory, so the report of the example above is in
`apps/web/pw-perf-results/`.

## CommonJS configs

In a CommonJS `playwright.config.js`, loading a TypeScript package config with `require()` gives
an object whose default export is in `.default`:

```js
const { defineConfig } = require('@playwright/test');
const { withPerf } = require('playwright-performance-regression/config');

module.exports = withPerf(defineConfig({/* ... */}), require('./pw-perf.config').default);
```

## What a request time includes

- The duration runs from the start of the request to the last byte of the response, including
  queueing and connection setup.
- A CORS preflight (`OPTIONS`) is part of the duration of the request that needed it, but it is
  not visible in `requestStart` and `ttfb`.
- If the page never reads a response body, the browser does not report when the response
  finished. The sample keeps its status without a duration, and the collector may wait for it
  at the end of the test. Read or cancel response bodies in your app code, or exclude the URL.
- Requests made by a service worker are skipped; responses a service worker generates are
  flagged in the report.
