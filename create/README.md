# create-playwright-performance-regression

Sets up [playwright-performance-regression](https://github.com/Meser6/playwright-performance-regression)
in an existing Playwright project with one command:

```sh
npm init playwright-performance-regression
# or: pnpm create playwright-performance-regression · yarn create playwright-performance-regression
```

It installs `playwright-performance-regression` as a dev dependency with the package manager of the
project (found by its lockfile) and starts the guided setup, `npx pw-perf init`. Arguments are passed
to the setup, e.g. `npm init playwright-performance-regression -- --yes`.
