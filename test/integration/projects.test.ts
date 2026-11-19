// Adoption integration projects (12, chapter 6; 03, chapter 3.4): each project runs with real
// Playwright and Chromium against the demo server, once in perf mode and once without it
// (12-AC-03). The projects import the package by name from copies with linked node_modules
// (see harness.ts).
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { firefox } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  bddgen,
  endpointKeys,
  expectStatus,
  hasSamples,
  RUN_TIMEOUT,
  sampleCount,
  startHarness,
  warningCodes,
} from './harness.ts';
import type { Harness, ProjectRun } from './harness.ts';

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness?.close();
});

const PERF = { PW_PERF_MODE: 'test', PW_PERF_REPEAT: '2' };

/** Without perf mode: every test passes once and no result carries samples. */
function expectPlainRun(run: ProjectRun, tests: number): void {
  expectStatus(run, 0);
  expect(run.report).toBeNull();
  expect(run.results.map((r) => r.status)).toEqual(Array(tests).fill('passed'));
  expect(run.results.filter(hasSamples)).toEqual([]);
}

describe('import-swap', () => {
  let dir = '';
  beforeAll(() => {
    dir = harness.copy('import-swap');
  });

  test(
    '03-AC-08 12-AC-03 swapping the imports to the package test measures requests and custom timings',
    async () => {
      const run = await harness.run(dir, { env: PERF });
      expectStatus(run, 0);
      expect(run.outcome?.exitCode).toBe(0);
      expect(run.report?.tests).toMatchObject({ expected: 4, unexpected: 0 });
      expect(endpointKeys(run)).toEqual([
        'GET /api/cart',
        'GET /api/products',
        'GET /api/search?q',
        'GET /api/users/:id',
        'GET /app',
        'GET /page',
      ]);
      expect(sampleCount(run, 'GET /api/products')).toBe(2);
      expect(run.report?.custom.search?.count).toBe(2);
    },
    RUN_TIMEOUT,
  );

  test(
    '12-AC-03 without perf mode the same tests pass and record nothing',
    async () => {
      expectPlainRun(await harness.run(dir), 2);
    },
    RUN_TIMEOUT,
  );
});

describe('custom-fixtures', () => {
  let dir = '';
  beforeAll(() => {
    dir = harness.copy('custom-fixtures');
  });

  test(
    '03-AC-09 12-AC-03 own fixtures, own contexts, role pages and a worker context are measured',
    async () => {
      const run = await harness.run(dir, { env: PERF });
      expectStatus(run, 0);
      expect(run.outcome?.exitCode).toBe(0);
      const keys = endpointKeys(run).filter((key) => key.startsWith('GET /api/cf/'));
      expect(keys).toEqual([
        'GET /api/cf/account-first',
        'GET /api/cf/account-second',
        'GET /api/cf/admin',
        'GET /api/cf/base-context',
        'GET /api/cf/late-page',
        'GET /api/cf/own-page',
        'GET /api/cf/tracked',
        'GET /api/cf/user',
      ]);
      // Two repetitions, one request each: nothing is counted twice.
      for (const key of keys) expect(sampleCount(run, key), key).toBe(2);
      // The late context override is found through the page.
      const autoTracked = (run.report?.warnings ?? []).filter(
        (w) => w.code === 'COLLECTOR_CONTEXT_AUTO_TRACKED',
      );
      expect(autoTracked.length).toBeGreaterThan(0);
      expect(run.results.every(hasSamples)).toBe(true);
    },
    RUN_TIMEOUT,
  );

  test(
    '12-AC-03 without perf mode the same tests pass and record nothing',
    async () => {
      expectPlainRun(await harness.run(dir), 7);
    },
    RUN_TIMEOUT,
  );
});

describe('multi-browser', () => {
  let dir = '';
  beforeAll(() => {
    dir = harness.copy('multi-browser');
  });

  test(
    '12-AC-03 perf mode measures the Chromium project and leaves Firefox and WebKit out',
    async () => {
      const run = await harness.run(dir, { env: PERF });
      expectStatus(run, 0);
      expect(run.outcome?.exitCode).toBe(0);
      expect(run.results.map((r) => [r.project, r.status])).toEqual([
        ['chromium', 'passed'],
        ['chromium', 'passed'],
      ]);
      expect(sampleCount(run, 'GET /api/products')).toBe(2);
      expect(run.output).toContain('firefox');
    },
    RUN_TIMEOUT,
  );

  // Best effort: CI installs Chromium only. Set INTEGRATION_FIREFOX=1 with the Firefox of the
  // installed Playwright to run it.
  test.skipIf(process.env.INTEGRATION_FIREFOX !== '1' || !existsSync(firefox.executablePath()))(
    'run.projects ["firefox"] measures Firefox (best effort)',
    async () => {
      const run = await harness.run(dir, { env: { ...PERF, PERF_PROJECTS: 'firefox' } });
      expectStatus(run, 0);
      expect(run.results.map((r) => r.project)).toEqual(['firefox', 'firefox']);
      expect(sampleCount(run, 'GET /api/products')).toBe(2);
    },
    RUN_TIMEOUT,
  );

  test(
    '12-AC-03 without perf mode the Chromium project passes and records nothing',
    async () => {
      expectPlainRun(await harness.run(dir, { args: ['--project', 'chromium'] }), 1);
    },
    RUN_TIMEOUT,
  );
});

describe('long-requests', () => {
  let dir = '';
  beforeAll(() => {
    dir = harness.copy('long-requests');
  });
  const ONCE = { PW_PERF_MODE: 'test', PW_PERF_REPEAT: '1' };
  const durations = (run: ProjectRun): Record<string, number> =>
    Object.fromEntries(run.results.map((r) => [r.title, r.duration]));

  test(
    '12-AC-03 open long requests become PENDING after the wait budget and no test fails',
    async () => {
      const run = await harness.run(dir, { env: ONCE });
      expectStatus(run, 0);
      expect(run.results.map((r) => r.status)).toEqual(['passed', 'passed', 'passed']);
      expect(run.report?.endpoints['GET /api/hang']?.statuses).toEqual({ PENDING: 1 });
      expect(run.report?.endpoints['GET /api/stream']?.statuses).toEqual({ 200: 1 });
      // EventSource is not a measured resource type by default.
      expect(endpointKeys(run)).not.toContain('GET /api/events');
      expect(warningCodes(run)).toContain('COLLECTOR_REQUESTS_PENDING');
      // Each test waits at most measure.pendingTimeoutMs (2000 ms) for its open requests.
      for (const [title, ms] of Object.entries(durations(run))) {
        expect(ms, title).toBeLessThan(2000 + 3000);
      }
    },
    RUN_TIMEOUT,
  );

  test(
    'excluded long requests are neither measured nor awaited',
    async () => {
      const run = await harness.run(dir, { env: { ...ONCE, EXCLUDE_LONG: '1' } });
      expectStatus(run, 0);
      expect(endpointKeys(run)).toEqual(['GET /api/products', 'GET /page']);
      expect(warningCodes(run)).not.toContain('COLLECTOR_REQUESTS_PENDING');
      for (const [title, ms] of Object.entries(durations(run))) {
        expect(ms, title).toBeLessThan(1500);
      }
    },
    RUN_TIMEOUT,
  );

  test(
    '12-AC-03 without perf mode the same tests pass and record nothing',
    async () => {
      expectPlainRun(await harness.run(dir), 3);
    },
    RUN_TIMEOUT,
  );
});

describe('existing-project', () => {
  let dir = '';
  beforeAll(() => {
    dir = harness.copy('existing-project');
    bddgen(dir);
  });
  const MEASURED = [
    'GET /api/ep/admin-dashboard',
    'GET /api/ep/admin-login',
    'GET /api/ep/catalog',
    'GET /api/ep/flaky',
    'GET /api/ep/orders',
    'GET /api/ep/recommendations',
    'GET /api/ep/seed',
  ];
  const epKeys = (run: ProjectRun): string[] =>
    endpointKeys(run).filter((key) => key.startsWith('GET /api/ep/'));

  test(
    '03-AC-09 12-AC-03 wrapper, reporters, test objects, mergeTests, playwright-bdd and mocks in perf mode',
    async () => {
      const run = await harness.run(dir, { env: PERF });
      // The flaky test fails once without retries: Playwright reports a failure, the
      // performance result decides the exit code (one failed execution of 15 is tolerated).
      expect(run.status, run.output).toBe(1);
      expect(run.outcome?.exitCode).toBe(0);
      expect(warningCodes(run)).toEqual(
        expect.arrayContaining(['TESTS_FAILED', 'TESTS_NOT_INSTRUMENTED']),
      );
      expect(warningCodes(run)).not.toContain('RUN_CONDITIONS_CHANGED');
      // Every browser test object is measured, also the playwright-bdd scenario and the
      // mocked route; the setup project and the request fixture are not.
      expect(epKeys(run)).toEqual(MEASURED);
      for (const key of MEASURED) expect(sampleCount(run, key), key).toBe(2);
      // Firefox is left out; the setup project runs once, the measured ones twice.
      const projects = run.results.map((r) => r.project);
      expect(projects.filter((p) => p === 'setup')).toHaveLength(1);
      expect(projects.filter((p) => p === 'chromium')).toHaveLength(12);
      expect(projects.filter((p) => p === 'bdd')).toHaveLength(2);
      expect(projects).not.toContain('firefox');
      // The kept junit reporter writes its file; the custom reporter is switched off.
      expect(existsSync(join(dir, 'junit.xml'))).toBe(true);
      expect(existsSync(join(dir, 'audit.txt'))).toBe(false);
      expect(run.output).toMatch(/globalTimeout/u);
      expect(run.output).toMatch(/maxFailures/u);
    },
    RUN_TIMEOUT,
  );

  test(
    '03-AC-09 a config wrapper outside withPerf() changes the run conditions: warned, still measured',
    async () => {
      const run = await harness.run(dir, { env: { ...PERF, OUTER_WRAPPER: '1' } });
      expect(warningCodes(run)).toContain('RUN_CONDITIONS_CHANGED');
      expect(epKeys(run)).toEqual(MEASURED);
    },
    RUN_TIMEOUT,
  );

  test(
    '12-AC-03 without perf mode the same tests pass (the flaky one on retry) and record nothing',
    async () => {
      rmSync(join(dir, 'junit.xml'), { force: true });
      const run = await harness.run(dir, { args: ['--project', 'chromium', '--project', 'bdd'] });
      expectStatus(run, 0);
      expect(run.report).toBeNull();
      expect(run.results.filter(hasSamples)).toEqual([]);
      const flaky = run.results.filter((r) => r.title === 'sometimes fails on the first attempt');
      expect(flaky.map((r) => r.status)).toEqual(['failed', 'passed']);
      expect(run.results.filter((r) => r.status !== 'passed')).toHaveLength(1);
      expect(run.results).toHaveLength(9);
      expect(existsSync(join(dir, 'audit.txt'))).toBe(true);
    },
    RUN_TIMEOUT,
  );
});
