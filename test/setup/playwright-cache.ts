// Per-worker Playwright transform cache for the tests that spawn Playwright (setupFiles in
// vitest.config.ts and vitest.perf.config.ts).
//
// Playwright compiles config and test files (and the linked dist/ of this package, which is not
// under node_modules) with Babel and caches the result in one directory per user. A cache entry is
// written with a plain writeFileSync, so a second Playwright process that reads the same entry at
// that moment gets an empty or truncated module: "SyntaxError: Unexpected end of input" or "does
// not provide an export named ...". Vitest runs test files in parallel workers, and after every
// `pnpm build` all of them miss the cache for dist/ at once, so the first full run failed at
// random (12-REQ-06: fixed, not retried). Each worker gets its own cache directory (both variables below): the Playwright
// runs of one worker are sequential, so no two processes write one entry at the same time, and
// the cache still works across runs. Child processes inherit the variable from process.env.
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cache = join(
  tmpdir(),
  'pw-perf-test-transform-cache',
  process.env.VITEST_POOL_ID ?? String(process.pid),
);
// Older Playwright versions read PWTEST_CACHE_DIR only, newer ones read
// PLAYWRIGHT_TRANSFORM_CACHE_DIR first.
process.env.PLAYWRIGHT_TRANSFORM_CACHE_DIR = cache;
process.env.PWTEST_CACHE_DIR = cache;
