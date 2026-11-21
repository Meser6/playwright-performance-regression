// 12-PERF-01: run-time overhead of perf mode on the demo suite (NF-01, 05-AC-10). The same
// project and Playwright config run alternately without perf mode (`playwright test --workers=1
// --retries=0` 5 times in a row) and in perf mode (`PW_PERF_MODE=test PW_PERF_PASSES=5 playwright
// test`), 5 rounds each;
// the medians of the wall times are compared (12-D-04, D-39).
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  DEMO_PROJECT,
  median,
  PLAYWRIGHT,
  recordResult,
  runNode,
  startWorkspace,
} from './helpers.ts';
import type { Workspace } from './helpers.ts';

const ROUNDS = 5;
const PASSES = 5;
const MAX_OVERHEAD = 0.05;

let workspace: Workspace;

beforeAll(async () => {
  workspace = await startWorkspace();
  // Constant backend delays like a real application's: the backend time is the same in both
  // variants, and the fixed cost of a run (report files) is not the whole run.
  const delays = Object.fromEntries(
    [
      'GET /api/items/1',
      'GET /api/items/2',
      'GET /api/items/3',
      'GET /api/cart',
      'GET /api/orders',
    ].map((key) => [key, 200]),
  );
  await workspace.control({ delays });
});

afterAll(async () => {
  await workspace?.close();
});

describe('12-PERF-01 run-time overhead', () => {
  test('05-AC-10 perf mode adds less than 5% to the run time of the demo suite', async () => {
    const env = (run: string) => ({
      DEMO_URL: workspace.server.url,
      INTEGRATION_OUT: join(workspace.dir, run),
      THRESHOLDS_DIR: join(workspace.dir, 'thresholds'),
    });
    const plainArgs = [PLAYWRIGHT, 'test', '--workers=1', '--retries=0'];
    // The plain variant starts Playwright once per pass, like the passes of perf mode.
    const runPlain = async (run: string) => {
      let wallMs = 0;
      for (let pass = 1; pass <= PASSES; pass++) {
        const p = await runNode(plainArgs, DEMO_PROJECT, env(`${run}-${String(pass)}`));
        expect(p.status, p.output).toBe(0);
        wallMs += p.wallMs;
      }
      return wallMs;
    };
    // Warm-up of both variants (browser start, file system caches), not counted.
    await runPlain('warm-plain');
    const perfEnv = (run: string) => ({
      ...env(run),
      PW_PERF_MODE: 'test',
      PW_PERF_PASSES: String(PASSES),
    });
    await runNode([PLAYWRIGHT, 'test'], DEMO_PROJECT, perfEnv('warm-perf'));

    const plain: number[] = [];
    const perf: number[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      plain.push(await runPlain(`plain-${String(round)}`));
      const m = await runNode([PLAYWRIGHT, 'test'], DEMO_PROJECT, perfEnv(`perf-${round}`));
      expect(m.status, m.output).toBe(0);
      expect(m.output).toContain('5 passes');
      perf.push(m.wallMs);
    }
    const overhead = median(perf) / median(plain) - 1;
    recordResult('12-PERF-01', {
      rounds: ROUNDS,
      passes: PASSES,
      plainMs: plain.map(Math.round),
      perfMs: perf.map(Math.round),
      plainMedianMs: Math.round(median(plain)),
      perfMedianMs: Math.round(median(perf)),
      overhead: Math.round(overhead * 10_000) / 10_000,
      limit: MAX_OVERHEAD,
    });
    expect(overhead).toBeLessThan(MAX_OVERHEAD);
  }, 900_000);
});
