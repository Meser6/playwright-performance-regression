# Adopting the package in an existing project

This page is for projects that already have a Playwright suite with their own fixtures, config
helpers, reporters or several test objects. For a new or simple project, `npm init
playwright-performance-regression` (see the [README](../README.md#install)) does everything below
for you.

- [The two changes](#the-two-changes)
- [Situation → what to do](#situation--what-to-do)
- [What `init` changes by itself](#what-init-changes-by-itself)
- [Choosing the tests to measure](#choosing-the-tests-to-measure)
- [Start in warn-only mode](#start-in-warn-only-mode)
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
   config object unchanged; inside one it switches to one worker, no retries and repetitions, and
   adds the package reporter.
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
| Firefox and WebKit projects in the config                                            | By default only Chromium projects are measured; the others are left out of the measurement run. Choose projects with `run.projects`.                                                                                                               |
| `page.route()` mocks                                                                 | Mocked requests are measured like real ones. Exclude them with `measure.exclude` (see [Mocked routes](#mocked-routes)).                                                                                                                            |
| Tests that create data                                                               | Repeated runs may collide; see [Tests that create data](#tests-that-create-data).                                                                                                                                                                  |

Every row is exercised by an integration project in this repository
(`test/integration/projects/`).

Order matters for `context` overrides: the package's override must be the last one. If a
fixture overrides `context` after `withPerfFixtures()` without using the base `context`, the
package's `context` override never runs; the `page` override still finds the page's context and
reports the informational diagnostic `COLLECTOR_CONTEXT_AUTO_TRACKED`. Keep `withPerfFixtures()`
last to avoid that.

## What `init` changes by itself

`pw-perf init` reads your project as text and changes only layouts it recognises. Everything else
is printed as an `INIT_MANUAL_STEP` instruction from the table above.

| File                  | Recognised layout                                                                                                                                      | Change                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright.config.*` | `export default defineConfig({...})`, `export default {...}`, `module.exports = defineConfig({...})` or `module.exports = {...}` as the last statement | wraps it in `withPerf(..., perfConfig)` and adds the imports (CommonJS: `require('./pw-perf.config').default`)                            |
| test object           | exactly one `.extend(` call in the project (not `expect.extend`), written as `export const test = X.extend(...)` or `exports.test = X.extend(...)`     | wraps it in `withPerfFixtures(...)`                                                                                                       |
| test files            | no `.extend(` and no `mergeTests` anywhere; files import an unaliased `test` from `@playwright/test`                                                   | switches that import to `playwright-performance-regression/test`; other names stay in an `@playwright/test` import, `test as setup` stays |
| `pw-perf.config.ts`   | missing                                                                                                                                                | created with the answers that differ from the defaults                                                                                    |
| `.gitignore`          | any                                                                                                                                                    | adds `perf-results/`                                                                                                                      |
| `package.json`        | scripts missing                                                                                                                                        | adds `perf:test` and `perf:thresholds` (one pair per environment)                                                                         |
| CI                    | GitHub Actions, GitLab CI, Jenkins or Azure Pipelines detected                                                                                         | adds a separate job file from [the CI recipes](ci.md)                                                                                     |

Not recognised, so left to you: other config wrappers, several test objects, `mergeTests`, a
`.json` package config, and existing scripts or CI files with other content. Running `init` again
changes nothing that is already set up.

## Choosing the tests to measure

A measurement run executes every measured test several times in one worker, so it is much slower
than your normal suite. Measure a subset: tag a few representative tests with `@perf` and run
`pw-perf test --grep @perf` (or select projects with `--project`). Good candidates load the main
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

Example: an endpoint called once by 2 tests with the default 5 repetitions has 10 samples, so the
median and error-rate checks run and the p95 check is skipped. With 2 tests and `--repeat 10` it
reaches 20 samples and p95 is checked too. A key below a check's minimum is reported as "median
only" or "not evaluated" instead of failing; see [FAQ](faq.md#why-do-most-keys-have-too-few-samples-or-are-evaluated-by-median-only).

Rough run time: `measured tests × repetitions × average test time`, plus setup projects once. With
20 tests of 6 s and 5 repetitions that is about 10 minutes on one worker. A thresholds run uses
10 repetitions by default (`run.repeat.thresholds`), so it takes about twice as long.

## Start in warn-only mode

For the first weeks, let the gate report without failing:

```ts
export default definePerfConfig({ gate: { warnOnly: true } });
```

Violations still appear in the summary and the report, but the exit code stays 0. Once the
thresholds are stable on your CI runners, remove `warnOnly`. `init` asks about this and sets it by
default.

## Settings in test files win

`withPerf()` sets workers, retries, repetitions, trace, video and screenshots in the config. Values
set in test files with `test.use()` or `test.describe.configure()` (for example `retries`,
`trace: 'on'` or `video`) are applied by Playwright after the config and win. The run still
measures, and the reporter warns with `RUN_CONDITIONS_CHANGED` when it sees retried results or
trace and video attachments. Remove those settings for the measured tests, or guard them with
`process.env.PW_PERF_MODE === undefined`.

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

Every measured test runs several times in a row. A test that creates a user with a fixed e-mail,
or an order with a fixed number, can fail on the second repetition. Make created data unique
(for example with `testInfo.repeatEachIndex` or a random suffix) or clean it up in the test. A few
failed executions only give a `TESTS_FAILED` warning; above `gate.maxFailedTestShare` (10% by
default) the run ends with `TESTS_FAILED_TOO_MANY` because the numbers cannot be trusted.

## Mocked routes

Requests answered by `page.route()` with `route.fulfill()` never reach your backend, but the
browser still reports them, so they appear as endpoint keys with near-zero times. Exclude their
URLs with `measure.exclude`, or keep tests that rely on mocks out of the measured subset.

## Monorepos

Run the CLI from the repository root and point it to the app's config:

```sh
npx pw-perf test -c apps/web/playwright.config.ts
npx pw-perf report --input apps/web/perf-results/report.json
```

Playwright is resolved from the directory of that config, and relative paths in the package
config (`report.dir`, `thresholds.dir`) are relative to the Playwright config's directory.

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
