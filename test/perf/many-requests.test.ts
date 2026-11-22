// 12-PERF-04 (V-04): one test with 20,000 requests, in perf mode and without it. Records the test
// duration in both runs, the size of the samples attachment, the time the package reporter
// spends after the test ends (onTestEnd of the probe reporter until onEnd, perf run minus plain
// run) and the wall time of both runs. The results are informational (12, chapter 7).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { SAMPLES_ATTACHMENT_NAME } from '../../src/core/types/index.ts';
import { PLAYWRIGHT, recordResult, ROOT, runNode, startWorkspace } from './helpers.ts';
import type { Workspace } from './helpers.ts';

const PROJECT = join(ROOT, 'test/perf/projects/many-requests');
const REQUESTS = 20_000;

interface Probe {
  endAt: number;
  tests: {
    status: string;
    durationMs: number;
    testEndAt: number;
    attachments: { name: string; bytes: number | null }[];
  }[];
}

let workspace: Workspace;

beforeAll(async () => {
  workspace = await startWorkspace();
});

afterAll(async () => {
  await workspace?.close();
});

describe('12-PERF-04 a test with 20,000 requests', () => {
  test('records onTestEnd time and attachment size of 20,000 requests', async () => {
    const env = (run: string) => ({
      DEMO_URL: workspace.server.url,
      INTEGRATION_OUT: join(workspace.dir, run),
      REQUESTS: String(REQUESTS),
    });
    const probe = (run: string): Probe =>
      JSON.parse(readFileSync(join(workspace.dir, run, 'probe.json'), 'utf8')) as Probe;

    const plain = await runNode([PLAYWRIGHT, 'test', '--workers=1'], PROJECT, env('plain'));
    expect(plain.status, plain.output).toBe(0);
    const perf = await runNode([PLAYWRIGHT, 'test'], PROJECT, {
      ...env('perf'),
      PW_PERF_MODE: 'thresholds',
    });
    expect(perf.status, perf.output).toBe(0);

    const p = probe('plain');
    const m = probe('perf');
    const plainTest = p.tests[0];
    const perfTest = m.tests[0];
    if (plainTest === undefined || perfTest === undefined) throw new Error('no test result');
    const samples = perfTest.attachments.find((a) => a.name === SAMPLES_ATTACHMENT_NAME);
    const report = JSON.parse(
      readFileSync(join(workspace.dir, 'perf', 'pw-perf-results', 'report.json'), 'utf8'),
    ) as { endpoints: Record<string, { count: number }>; warnings: { code: string }[] };
    // The page load is a request too; the collector keeps at most 20,000 per test
    // (COLLECTOR_SAMPLE_LIMIT_REACHED for the rest).
    const counted = Object.values(report.endpoints).reduce((sum, a) => sum + a.count, 0);
    recordResult('12-PERF-04', {
      requests: REQUESTS,
      plainTestMs: Math.round(plainTest.durationMs),
      perfTestMs: Math.round(perfTest.durationMs),
      attachmentBytes: samples?.bytes ?? null,
      afterTestEndPlainMs: Math.round(p.endAt - plainTest.testEndAt),
      afterTestEndPerfMs: Math.round(m.endAt - perfTest.testEndAt),
      onTestEndEstimateMs: Math.round(
        m.endAt - perfTest.testEndAt - (p.endAt - plainTest.testEndAt),
      ),
      plainWallMs: Math.round(plain.wallMs),
      perfWallMs: Math.round(perf.wallMs),
      samplesInReport: counted,
      warnings: report.warnings.map((w) => w.code),
    });
    expect(samples?.bytes).toBeGreaterThan(0);
    expect(counted).toBe(REQUESTS);
  });
});
