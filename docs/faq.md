# FAQ

## Why does the run take so long?

A measurement run executes every measured test several times (5 by default, 10 in a thresholds
run) in a single worker, so tests do not compete for the backend and the timings are comparable.
Measure a representative subset: tag tests with `@perf` and run
`PW_PERF_MODE=test npx playwright test --grep @perf`, or select projects with `--project`. See [Choosing the tests to measure](adoption.md#choosing-the-tests-to-measure).

## Where do false alarms come from?

Most often from a noisy environment: shared CI runners, a QA environment used by other pipelines
at the same time, or thresholds derived on a different machine than the one running the gate.
Derive thresholds on the CI runners ([Thresholds](thresholds.md#deriving-thresholds-the-recommended-flow)),
isolate the run ([CI](ci.md#isolation-of-the-environment-and-the-runner)), choose the
`loose` headroom preset on a noisy environment (`thresholds: { preset: 'loose' }`), and keep the
measurement job non-blocking (`continue-on-error`) for the first weeks. The p95 and p99 checks need enough samples to be stable; the
checks on Apdex, slow share and error rate compare confidence bounds rather than raw values, so a
single slow sample does not fail them.

## Exit code 2: what now?

At least one endpoint key broke a limit in a way that blocks. Open
`reports/pw-perf/report.html` (or read the summary in the log): the violations table lists each key,
the check, the measured value, the limit and how far over it is; the details show the slowest
samples and the tests that made the requests. Then:

- a real regression: fix it, or, if the slowdown is accepted, re-derive the thresholds in that pull
  request so the reviewers see the change ([Thresholds](thresholds.md#when-to-derive));
- a known, temporary problem on one key: mute it with `gate`, `note` and `until`
  ([Muting](thresholds.md#muting-a-flaky-key));
- noise: see the previous question.

Exit code 3 is different: the measurement itself did not work. The summary lists the tool errors;
each code is explained in [Troubleshooting](troubleshooting.md).

## Why do most keys have too few samples, or are evaluated by median only?

Each check needs a minimum number of successful samples per key: 5 for the median and the error
rate, 20 for p95, Apdex and the slow share, 100 for p99. Endpoints called once by one test get
only as many samples as passes. Keys below a minimum are not failed; the summary counts them
as "checked by median only (few samples)" or "skipped (too few samples)". To get more checks on important endpoints, measure more tests
that call them or raise the passes (`run.passes`, `PW_PERF_PASSES`). The arithmetic is in
[Choosing the tests to measure](adoption.md#choosing-the-tests-to-measure).

## My mocked routes show up as endpoints

Requests answered with `page.route()` and `route.fulfill()` are still requests of the page, so they
are measured. Exclude their URLs with `measure.exclude`, or leave tests that rely on mocks out of
the measured subset. See [Mocked routes](adoption.md#mocked-routes).

## Can I measure Firefox or WebKit?

The measured projects are the ones your test command selects: all projects without `--project`,
except setup and teardown projects (dependencies and teardowns of other projects). So a Firefox or
WebKit project is measured when the command runs it, but the timing data those browsers report
differs and this is best effort, not tested on every release. Measure one browser engine per run,
e.g. `PW_PERF_MODE=test npx playwright test --project chromium`: samples of different engines go
into the same keys and give the warning `STATS_MULTIPLE_BROWSERS`.

## Is this a load test?

No. The package measures how long your backend takes to answer the requests of normal e2e tests,
one test at a time, and compares that with committed limits. It does not generate load and tells
you nothing about behaviour under many concurrent users. Use a load-testing tool for that.

## Are requests from the `request` fixture measured?

Yes, when the test imports `test` from the wrapped test object (`withPerfFixtures()` or
`playwright-performance-regression/test`). Calls of `request`, `page.request` and
`context.request` get their own keys with the prefix `request`, e.g. `request GET /api/orders/:id`,
next to `GET /api/orders/:id` for the same endpoint called by the page. Both live in
`pw-perf-thresholds.json`, and the Endpoints table of the report shows the source of each key.

They are separate keys on purpose: the browser times a request from sending it to the last byte,
while a `request` call is timed in the worker from the call to the response, with its own
connections, no CORS preflight and no browser cache. The difference is a few milliseconds and
constant, so each source gets limits from its own measurements and a slower backend shows in both,
but the numbers of the two sources must not be mixed.

A context made with `playwright.request.newContext()` is measured after
`trackRequestContext(context)` from `playwright-performance-regression/fixture` (in any fixture,
also a worker fixture) or `perf.trackRequestContext(context)` (in a test). In a fixture of the
object you pass to `withPerfFixtures()`, use the import: the `perf` fixture is typed only in tests
and in fixtures added after `withPerfFixtures()`, so `tsc` reports `perf` as missing there. Other HTTP clients (Node
`fetch`, axios) are not measured. To skip data setup calls, exclude their URLs with
`measure.exclude`.

## Does the package change my normal test runs?

No. Outside a measurement run `withPerf()` returns your config unchanged and `withPerfFixtures()`
only adds the `perf` fixture, whose methods do nothing there. Measurement runs are started by your test command with `PW_PERF_MODE=test` or
`PW_PERF_MODE=thresholds` in front of it.
