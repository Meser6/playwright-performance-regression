# playwright-performance-regression

Catch backend performance regressions from the Playwright tests you already have.

> **Status: under construction.** Not published on npm yet. The API, file formats and CLI may
> change without notice until the first release.

## What it will do

- Measure backend request timings while your existing Playwright e2e tests run.
- Group requests into endpoints and compute statistics per endpoint.
- Derive thresholds and commit them to your repository, like code.
- Fail the CI run when an endpoint gets slower or starts returning errors.

## License

[MIT](LICENSE)
