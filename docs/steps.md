# Step timings

The package can measure the duration of your existing `test.step` blocks, without any change in
the tests or page objects. Each step becomes a key of kind `step` with its own statistics,
thresholds file and checks, next to the endpoint keys.

## On by default

Steps are measured by default (`measure.steps: true`); nothing to set up. To measure only the
backend requests, turn it off:

```ts
// pw-perf.config.ts
import { definePerfConfig } from 'playwright-performance-regression';

export default definePerfConfig({ measure: { steps: false } });
```

```ts
// pages/login.page.ts: existing code, unchanged
async login(user: string) {
  await test.step('login', async () => {
    await test.step('fill form', async () => { /* ... */ });
    await test.step('submit', async () => { /* ... */ });
  });
}
// keys: "login", "login › fill form", "login › submit"
```

Steps are read from the step tree Playwright reports for every test result, so steps in page
objects that import `test` from `@playwright/test` are measured too. Outside perf mode nothing
changes.

The step file is `pw-perf-thresholds.steps.json` (with an environment label
`pw-perf-thresholds.steps.<env>.json`), next to `pw-perf-thresholds.json` for the endpoints. It is
read and written only while `measure.steps` is on. A run that finds no `test.step` block prints
one line, `No test.step blocks found, so there are no step thresholds.`, and creates no step file.

## Keys

- A key is the path of step titles from the top level, joined with `›`: a step `submit` inside
  `login` is `login › submit`. The test is not part of the key, so a `login` step used in 50 tests
  is one key with samples from all of them.
- Every occurrence of a step is a sample of the same key, also in a loop.
- `groupBy: 'test'` puts the test in front of the key, e.g.
  `tests/checkout.spec.ts › checkout › pays by card » login › submit`.
- Steps called in `beforeEach`, `afterEach` or a fixture have the same key as in the test body.
- Steps of setup and teardown projects are not measured.

## Which steps

| Option               | Default         | Meaning                                                                                                                                                                                                                                              |
| -------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `categories`         | `['test.step']` | Playwright step categories measured: `test.step`, `expect`, `pw:api`, `fixture`, `hook`. Steps of other categories are not keys and do not count for the depth. `expect` and `pw:api` give many keys with locators and values and are rarely useful. |
| `maxDepth`           | `3`             | Deepest step level measured (1–10). Deeper steps are included in the time of their ancestor.                                                                                                                                                         |
| `include`, `exclude` | `[]`            | Patterns (text or regular expression) matched against the step part of the key after sanitization. A step that does not pass the filters gives no sample, but stays a segment of the keys of its nested steps. `exclude` wins.                       |
| `groupBy`            | `'step'`        | `'test'` gives one key per test and step path.                                                                                                                                                                                                       |
| `normalizeTitles`    | `true`          | `false` keeps ids, dates and numbers in the keys; privacy rules still apply.                                                                                                                                                                         |
| `redactQuotedValues` | `false`         | `true` replaces quoted values in titles with `:value`.                                                                                                                                                                                               |

```ts
measure: { steps: { maxDepth: 2, exclude: [/^debug/] } }
```

## Sanitization of titles

Step titles often come from templates with test data. Before a title becomes a key it is cleaned,
private data is replaced and values that would split one step into many keys are normalized.
Raw titles never reach the report, the console, the HTML report or the thresholds files; a key
points to its step by `file:line` ("Defined at").

| Title                                          | Key                                   |
| ---------------------------------------------- | ------------------------------------- |
| `Open order 4711`                              | `Open order :id`                      |
| `Login as jan.kowalski@example.com`            | `Login as :email`                     |
| `Open https://app.example/orders/42?token=abc` | `Open :url`                           |
| `Authorize with Bearer abc.def-123`            | `Authorize with Bearer :secret`       |
| `Login with password=Secr3t!`                  | `Login with password=:secret`         |
| `Navigate to /orders/4711/edit?tab=2`          | `Navigate to /orders/:id/edit?:query` |
| `Report for 2026-11-20`                        | `Report for :date`                    |
| `Pay 1,299.00 PLN with 10% discount`           | `Pay :num PLN with :num discount`     |
| `Search ${query}`                              | `Search :value`                       |
| `Click "Save"`                                 | `Click "Save"`                        |
| `Search "Order 4711"`                          | `Search "Order :id"`                  |

URLs, tokens, e-mail addresses, phone numbers, IP addresses and secrets are always replaced, also
inside quotes and with `normalizeTitles: false`. A URL or a secret in a title gives the warning
`STEPS_SECRET_REDACTED` with the locations of the steps: such data also reaches Playwright's own
reports and traces, so remove it from the title.

Quoted values stay in the keys by default, because they are usually button or field labels:
`Click "Save"` and `Click "Cancel"` are two keys. If your titles put test data in quotes (names,
search terms), set `redactQuotedValues: true`: then `Click "Save"` becomes `Click ":value"`.

Words the rules do not recognize, such as names without quotes or dates in words (`18 Nov 2026`),
stay in the key. When ten or more keys differ only in one word, the warning
`STEPS_HIGH_CARDINALITY` shows the template; keep the value out of the title, add a pattern to
`keys.extraIdPatterns` or exclude the step.

## Checks and thresholds

Step keys are checked by the same rules as endpoints and their thresholds are derived with the same
formulas. Only the default limits are wider, because steps include waiting for the page:

| Option                              | `step` default                      |
| ----------------------------------- | ----------------------------------- |
| `checks.time.median.limit.step`     | 10000 ms                            |
| `checks.time.percentile.limit.step` | 15000 ms                            |
| `checks.time.p99.limit.step`        | 30000 ms                            |
| `checks.slowShare.t.step`           | min 1000, max 10000, medianFactor 2 |

Durations of steps come from the worker clock in whole milliseconds; steps shorter than about
20 ms are too short to check. A step that throws or does not finish is an error sample and is left
out of the time statistics. Errors of steps in tests that failed are not counted for the `errors`
rule: the failed test is already reported.

The gate tolerance counts the keys of all kinds together, so turning steps on adds keys to it;
with a percentage tolerance this changes how many violations are allowed.

A hand-set step threshold is an entry with `locked: true` in `pw-perf-thresholds.steps.json`:

```json
{ "checkout › pay": { "locked": true, "percentile": 3000 } }
```

## Warnings

| Code                     | When                                          |
| ------------------------ | --------------------------------------------- |
| `STEPS_HIGH_CARDINALITY` | ten or more step keys differ only in one word |
| `STEPS_TOO_MANY_KEYS`    | more than 1000 step keys                      |
| `STEPS_SECRET_REDACTED`  | a step title contained a URL or a secret      |

See [Troubleshooting](troubleshooting.md) for each code.
