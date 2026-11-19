# Example: with setup

A project closer to a real suite:

- a `setup` project that logs in once and saves the session, and a teardown project; both run
  once and are not measured;
- its own `tests/fixtures.ts` with a page object, wrapped in `withPerfFixtures()`;
- `pw-perf.config.ts` with an origin label for the API, an extra exclude and a warn-only start;
- a custom measurement with `perf.measure()`;
- only tests tagged `@perf` are measured (`--grep @perf` in the scripts).

The tests run against the demo app of this repository, which Playwright starts on ports 3000 and 3001.

```sh
# in the repository root, once: build the package
pnpm install && pnpm build

cd examples/with-setup
npm install
npx playwright install chromium

npm run perf:thresholds   # writes perf-thresholds.api.json and perf-thresholds.custom.json
npm run perf:test
```

Endpoint keys of the API origin carry it after the method (for example `GET api/api/prices`); keys of the
page origin have no label.
