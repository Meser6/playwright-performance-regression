# Example: basic

The smallest setup: an ESM TypeScript project without Playwright projects. The tests import
`test` and `expect` from `playwright-performance-regression/test`, and `playwright.config.ts` is
wrapped in `withPerf()`. There is no package config file, so all defaults apply.
`tests/api.spec.ts` is an API test: its `request` calls are measured as their own keys
(`request GET /api/products`), next to the same endpoint called by the page.

The tests run against the demo app of this repository, which Playwright starts on port 3000.

```sh
# in the repository root, once: build the package
pnpm install && pnpm build

cd examples/basic
npm install
npx playwright install chromium

PW_PERF_MODE=thresholds npm test   # measure and write pw-perf-thresholds.json
PW_PERF_MODE=test npm test         # measure again and compare with the thresholds
```

`reports/pw-perf/report.html` shows the result. Outside the repository, depend on the published
package instead of `file:../..`.
