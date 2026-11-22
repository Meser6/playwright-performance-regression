# create-playwright-performance-regression

Sets up [playwright-performance-regression](https://github.com/Meser6/playwright-performance-regression)
in an existing Playwright project with one command:

```sh
npm init playwright-performance-regression
# or: pnpm create playwright-performance-regression · yarn create playwright-performance-regression
```

It installs `playwright-performance-regression` as a dev dependency with the package manager of the
project (found by its lockfile) and starts the guided setup. In a project where the package is
already installed it only starts the setup, so you can run it again at any time.

The command takes no arguments. The setup asks its questions in a terminal (without a terminal it
only shows the planned changes); these variables change it:

| Variable                | Effect                                                                         |
| ----------------------- | ------------------------------------------------------------------------------ |
| `PW_PERF_LANG=<code>`   | wizard language without the question: `en`, `es`, `fr`, `pl`, `it`, `uk`, `ru` |
| `PW_PERF_DRY_RUN=1`     | show the planned changes only, write nothing                                   |
| `PW_PERF_NO_TUTORIAL=1` | print the manual setup steps only, change nothing                              |
