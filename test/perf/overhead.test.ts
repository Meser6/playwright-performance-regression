// 12-PERF-01: run-time overhead of perf mode on the demo suite (NF-01, 05-AC-10). The same
// project and Playwright config run alternately without perf mode (`playwright test --workers=1
// --retries=0 --repeat-each=5`) and through the CLI (`pw-perf test --repeat 5`), 5 times each;
// the medians of the wall times are compared (12-D-04).
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  CLI,
  DEMO_PROJECT,
  median,
  PLAYWRIGHT,
  recordResult,
  runNode,
  startWorkspace,
} from './helpers.ts';
import type { Workspace } from './helpers.ts';

const ROUNDS = 5;
const REPEAT = 5;
const MAX_OVERHEAD = 0.05;

let workspace: Workspace;

beforeAll(async () => {
  workspace = await startWorkspace();
  // Constant backend delays like a real application's: the backend time is the same in both
  // variants, and the fixed cost of a run (CLI process, report files) is not the whole run.
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
    // Warm-up of both variants (browser start, file system caches), not counted.
    await runNode([...plainArgs, `--repeat-each=${REPEAT}`], DEMO_PROJECT, env('warm-plain'));
    await runNode([CLI, 'test', '--repeat', String(REPEAT)], DEMO_PROJECT, env('warm-perf'));

    const plain: number[] = [];
    const perf: number[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      const p = await runNode(
        [...plainArgs, `--repeat-each=${REPEAT}`],
        DEMO_PROJECT,
        env(`plain-${round}`),
      );
      expect(p.status, p.output).toBe(0);
      plain.push(p.wallMs);
      const m = await runNode(
        [CLI, 'test', '--repeat', String(REPEAT)],
        DEMO_PROJECT,
        env(`perf-${round}`),
      );
      expect(m.status, m.output).toBe(0);
      expect(m.output).toContain('perf mode "test"');
      perf.push(m.wallMs);
    }
    const overhead = median(perf) / median(plain) - 1;
    recordResult('12-PERF-01', {
      rounds: ROUNDS,
      repeat: REPEAT,
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
