// Statistical tests on the demo app (12, chapter 7): 12-STAT-01 (S-02), 12-STAT-02 (S-03) and
// 12-STAT-03 (S-04). The demo server adds deterministic log-normal noise (12-REQ-09); the
// reporter integration project runs in the environment mode (PW_PERF_MODE, D-35), and the result
// is the exitCode of its outcome.json (04-REQ-62). They check robustness against
// controlled noise, not against the noise of a real environment (12-REQ-13). Weekly and before a
// release (`pnpm test:stats`); the results are written as a CI artifact.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { resolveConfig } from '../../src/core/config/index.ts';
import { stringifyStable } from '../../src/core/format/index.ts';
import { parseRunReport } from '../../src/core/schema/index.ts';
import { deriveThresholds } from '../../src/core/thresholds/index.ts';
import { loadThresholds } from '../../src/io/index.ts';
import {
  DEMO_PROJECT,
  PLAYWRIGHT,
  recordResult,
  runNode,
  startWorkspace,
} from '../perf/helpers.ts';
import type { ProcessRun, Workspace } from '../perf/helpers.ts';

const PASSES = '10';
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

/**
 * `PW_PERF_MODE=<mode> PW_PERF_PASSES=10 playwright test` in the demo project with its thresholds
 * in `thresholds`; `code` is the exitCode of outcome.json (null without the file).
 */
function perf(
  mode: 'test' | 'thresholds',
  thresholds: string,
): Promise<ProcessRun & { out: string; code: number | null }> {
  const out = join(workspace.dir, `run ${++runs}`);
  return runNode([PLAYWRIGHT, 'test'], DEMO_PROJECT, {
    DEMO_URL: workspace.server.url,
    INTEGRATION_OUT: out,
    THRESHOLDS_DIR: join(workspace.dir, thresholds),
    PW_PERF_MODE: mode,
    PW_PERF_PASSES: PASSES,
  }).then((run) => {
    const file = join(out, 'reports/pw-perf', 'outcome.json');
    const code = existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as { exitCode: number }).exitCode
      : null;
    return { ...run, out, code };
  });
}

describe('statistical tests', () => {
  test('12-STAT-01 09-AC-09 a 300 ms slowdown of one endpoint blocks the run and names the endpoint and test', async () => {
    await setDelays(1);
    const thresholds = await perf('thresholds', 'stat-01');
    expect(thresholds.status, thresholds.output).toBe(0);

    await setDelays(2, { 'GET /api/cart': BASE_DELAY + 300 });
    const run = await perf('test', 'stat-01');
    const violation = /✖\s+api\s+GET \/api\/cart\s/u;
    const slowest = /slowest: GET \/api\/cart — \d+ ms in "(item \d|checkout)"/u;
    recordResult('12-STAT-01', {
      exitCode: run.code,
      cartViolation: violation.test(run.output),
      slowestLine: slowest.exec(run.output)?.[0] ?? null,
      otherViolations: run.output
        .split('\n')
        .filter((line) => /^\s+✖/u.test(line) && !line.includes('GET /api/cart')),
    });
    expect(run.code, run.output).toBe(2);
    expect(run.output).toMatch(violation);
    expect(run.output).toMatch(slowest);
  });

  test('12-STAT-02 without changes at most 1 of 10 runs fails on noise', async () => {
    await setDelays(3);
    const thresholds = await perf('thresholds', 'stat-02');
    expect(thresholds.status, thresholds.output).toBe(0);
    const codes: (number | null)[] = [];
    for (let i = 0; i < 10; i++) {
      await setDelays(100 + i);
      const run = await perf('test', 'stat-02');
      expect([0, 2], run.output).toContain(run.code);
      codes.push(run.code);
    }
    const falseAlarms = codes.filter((code) => code === 2).length;
    recordResult('12-STAT-02', { runs: codes.length, exitCodes: codes, falseAlarms, limit: 1 });
    expect(falseAlarms).toBeLessThanOrEqual(1);
  });

  test('12-STAT-03 10-AC-02 deriving twice from the same report gives identical bytes', async () => {
    await setDelays(4);
    const source = await perf('thresholds', 'stat-03-source');
    expect(source.status, source.output).toBe(0);
    const path = join(source.out, 'reports/pw-perf', 'report.json');
    const report = parseRunReport(readFileSync(path, 'utf8'), path);
    if (!report.ok) throw new Error(JSON.stringify(report.issues));
    // The snapshot of the report is a valid input with source 'snapshot' (02-REQ-17).
    const cfg = resolveConfig(report.value.config as never, {
      source: 'snapshot',
      mode: 'thresholds',
    });
    if (!cfg.ok) throw new Error(JSON.stringify(cfg.issues));
    const config = cfg.value.config;
    const empty = join(workspace.dir, 'stat-03-empty');
    mkdirSync(empty, { recursive: true });
    const loaded = await loadThresholds({
      configDir: empty,
      dir: '.',
      filePrefix: config.thresholds.filePrefix,
      env: null,
      steps: config.measure.steps.enabled,
    });
    const derive = (): string => {
      const derived = deriveThresholds(report.value, config, loaded, {
        env: null,
        prune: false,
        toolVersion: '0.0.0',
      });
      if (!derived.ok) throw new Error(JSON.stringify(derived.issues));
      return stringifyStable(derived.value.files.map((file) => file.content));
    };
    const a = derive();
    const b = derive();
    recordResult('12-STAT-03', { bytes: a.length, identical: a === b });
    expect(a.length).toBeGreaterThan(0);
    expect(b).toBe(a);
  });
});
