// The check mode with real Playwright (04, chapter 4.11).
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { RUN_TIMEOUT, startHarness } from './harness.ts';
import type { Harness } from './harness.ts';

let harness: Harness;
beforeAll(async () => {
  harness = await startHarness();
});
afterAll(async () => {
  await harness?.close();
});

const stateFiles = (): string[] =>
  readdirSync(tmpdir()).filter(
    (f) => f.startsWith('playwright-performance-regression-') && f.endsWith('.check.json'),
  );

describe('check', () => {
  let shared = '';
  beforeAll(() => {
    shared = harness.copy('check');
  });

  test(
    '04-AC-34 04-AC-37 --max-tests 2 runs 2 tests, skips 10, runs setup, writes nothing, exit code 0',
    async () => {
      const dir = shared;
      const before = stateFiles();
      const run = await harness.run(dir, { cli: true, args: ['check', '--max-tests', '2'] });
      expect(run.status, run.output).toBe(0);
      expect(run.output).toContain(
        'pw-perf · check · 2 of 12 tests run (2 passed) · 10 skipped by check',
      );
      expect(run.output).toContain('dependency  setup · runs once, not measured');
      expect(run.output).toContain('CHECKED');
      expect(run.output).toContain('check finished · exit code 0');
      expect(run.output).toMatch(
        /Next: derive thresholds on the CI machines: npx pw-perf thresholds/u,
      );
      expect(existsSync(join(dir, 'pw-perf-results', 'report.json'))).toBe(false);
      expect(readdirSync(dir).filter((f) => f.startsWith('pw-perf-thresholds'))).toEqual([]);
      expect(stateFiles()).toEqual(before);
    },
    RUN_TIMEOUT,
  );

  test(
    '04-AC-34 04-AC-37 environment mode: a failed first test still runs 2 tests; exit code of Playwright 1, no outcome.json',
    async () => {
      const dir = shared;
      rmSync(join(dir, 'pw-perf-results'), { recursive: true, force: true });
      const run = await harness.run(dir, {
        env: { PW_PERF_MODE: 'check', PW_PERF_MAX_TESTS: '2', CHECK_FAIL_FIRST: '1' },
      });
      expect(run.status, run.output).toBe(1);
      expect(run.output).toContain('2 of 12 tests run (1 passed, 1 failed)');
      expect(run.output).toContain('CHECKED');
      expect(existsSync(join(dir, 'pw-perf-results', 'outcome.json'))).toBe(false);
    },
    RUN_TIMEOUT,
  );

  test(
    '04-AC-37 --shard is refused with exit code 3',
    async () => {
      const run = await harness.run(shared, { cli: true, args: ['check', '--shard', '1/2'] });
      expect(run.status, run.output).toBe(3);
    },
    RUN_TIMEOUT,
  );
});
