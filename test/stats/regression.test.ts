// Statistical tests on the demo app (12, chapter 7): 12-STAT-01 (S-02), 12-STAT-02 (S-03) and
// 12-STAT-03 (S-04). The demo server adds deterministic log-normal noise (12-REQ-09); the
// reporter integration project runs through the built CLI. They check robustness against
// controlled noise, not against the noise of a real environment (12-REQ-13). Weekly and before a
// release (`pnpm test:stats`); the results are written as a CI artifact.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { CLI, DEMO_PROJECT, recordResult, runNode, startWorkspace } from '../perf/helpers.ts';
import type { ProcessRun, Workspace } from '../perf/helpers.ts';

const REPEAT = '10';
const BASE_DELAY = 100;
const ENDPOINTS = [
  'GET /api/items/1',
  'GET /api/items/2',
  'GET /api/items/3',
  'GET /api/cart',
  'GET /api/orders',
];
const NOISE_SIGMA = 0.2;

let workspace: Workspace;
let runs = 0;

beforeAll(async () => {
  workspace = await startWorkspace();
});

afterAll(async () => {
  await workspace?.close();
});

async function setDelays(seed: number, extra: Record<string, number> = {}): Promise<void> {
  const delays = Object.fromEntries(ENDPOINTS.map((key) => [key, BASE_DELAY]));
  await workspace.control({ delays: { ...delays, ...extra }, noise: { seed, sigma: NOISE_SIGMA } });
}

/** `pw-perf <args>` in the demo project with its thresholds in `thresholds`. */
function cli(args: string[], thresholds: string): Promise<ProcessRun & { out: string }> {
  const out = join(workspace.dir, `run ${++runs}`);
  return runNode([CLI, ...args], DEMO_PROJECT, {
    DEMO_URL: workspace.server.url,
    INTEGRATION_OUT: out,
    THRESHOLDS_DIR: join(workspace.dir, thresholds),
  }).then((run) => ({ ...run, out }));
}

const files = (dir: string): Record<string, string> =>
  Object.fromEntries(
    readdirSync(join(workspace.dir, dir))
      .filter((name) => name.startsWith('perf-thresholds.'))
      .sort()
      .map((name) => [name, readFileSync(join(workspace.dir, dir, name), 'utf8')]),
  );

describe('statistical tests', () => {
  test('12-STAT-01 09-AC-09 a 300 ms slowdown of one endpoint blocks the run and names the endpoint and test', async () => {
    await setDelays(1);
    const thresholds = await cli(['thresholds', '--repeat', REPEAT], 'stat-01');
    expect(thresholds.status, thresholds.output).toBe(0);

    await setDelays(2, { 'GET /api/cart': BASE_DELAY + 300 });
    const run = await cli(['test', '--repeat', REPEAT], 'stat-01');
    const violation = /✖\s+api\s+GET \/api\/cart\s/u;
    const slowest = /slowest: GET \/api\/cart — \d+ ms in "(item \d|checkout)"/u;
    recordResult('12-STAT-01', {
      exitCode: run.status,
      cartViolation: violation.test(run.output),
      slowestLine: slowest.exec(run.output)?.[0] ?? null,
      otherViolations: run.output
        .split('\n')
        .filter((line) => /^\s+✖/u.test(line) && !line.includes('GET /api/cart')),
    });
    expect(run.status, run.output).toBe(2);
    expect(run.output).toMatch(violation);
    expect(run.output).toMatch(slowest);
  });

  test('12-STAT-02 without changes at most 1 of 10 runs fails on noise', async () => {
    await setDelays(3);
    const thresholds = await cli(['thresholds', '--repeat', REPEAT], 'stat-02');
    expect(thresholds.status, thresholds.output).toBe(0);
    const codes: (number | null)[] = [];
    for (let i = 0; i < 10; i++) {
      await setDelays(100 + i);
      const run = await cli(['test', '--repeat', REPEAT], 'stat-02');
      expect([0, 2], run.output).toContain(run.status);
      codes.push(run.status);
    }
    const falseAlarms = codes.filter((code) => code === 2).length;
    recordResult('12-STAT-02', { runs: codes.length, exitCodes: codes, falseAlarms, limit: 1 });
    expect(falseAlarms).toBeLessThanOrEqual(1);
  });

  test('12-STAT-03 10-AC-02 thresholds --from twice on the same report gives identical bytes', async () => {
    await setDelays(4);
    const source = await cli(['thresholds', '--repeat', REPEAT], 'stat-03-source');
    expect(source.status, source.output).toBe(0);
    const report = join(source.out, 'perf-results', 'report.json');
    const first = await cli(['thresholds', '--from', report], 'stat-03-a');
    const second = await cli(['thresholds', '--from', report], 'stat-03-b');
    expect(first.status, first.output).toBe(0);
    expect(second.status, second.output).toBe(0);
    const a = files('stat-03-a');
    const b = files('stat-03-b');
    recordResult('12-STAT-03', {
      files: Object.keys(a),
      identical: JSON.stringify(a) === JSON.stringify(b),
      sameAsSourceRun: JSON.stringify(a) === JSON.stringify(files('stat-03-source')),
    });
    expect(Object.keys(a).length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });
});
