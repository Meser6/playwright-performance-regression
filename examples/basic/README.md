# Example: basic

The smallest setup: an ESM TypeScript project without Playwright projects. The tests import
`test` and `expect` from `playwright-performance-regression/test`, and `playwright.config.ts` is
wrapped in `withPerf()`. There is no package config file, so all defaults apply.

The tests run against the demo app of this repository, which Playwright starts on port 3000.

```sh
# in the repository root, once: build the package
pnpm install && pnpm build

cd examples/basic
npm install
npx playwright install chromium

npm run perf:thresholds   # measure and write perf-thresholds.api.json
npm run perf:test         # measure again and compare with the thresholds
```

`perf-results/report.html` shows the result. Outside the repository, depend on the published
package instead of `file:../..`.
