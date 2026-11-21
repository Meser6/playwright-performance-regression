// The check mode: random hosts, the estimate and the output (04-REQ-50 – 04-REQ-52).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  estimateText,
  msPerTest,
  proposePattern,
  randomHostIssue,
  startEstimate,
} from '../../../src/core/check/index.ts';
import { formatCheckSummary } from '../../../src/console/check-summary.ts';
import type { CheckSummary } from '../../../src/console/check-summary.ts';
import { readModeState } from '../../../src/mode/index.ts';

describe('04-AC-36 CHECK_RANDOM_HOST', () => {
  test('generated hosts get a pattern and a label', () => {
    expect(proposePattern({ origin: 'https://pr-4821.ci.example.com', base: true })).toEqual({
      pattern: 'https://pr-*.ci.example.com',
      label: '',
    });
    expect(proposePattern({ origin: 'https://api-pr-4821.ci.example.com', base: false })).toEqual({
      pattern: 'https://api-pr-*.ci.example.com',
      label: 'api',
    });
    expect(proposePattern({ origin: 'https://k3j9x2ab.example.com', base: false })?.pattern).toBe(
      'https://*.example.com',
    );
  });

  test('ordinary hosts, localhost and IP addresses give no warning', () => {
    const plain = [
      'https://api.example.com',
      'https://v2.example.com',
      'http://localhost:54321',
      'http://10.0.0.12',
    ];
    expect(randomHostIssue(plain.map((origin) => ({ origin, base: false })))).toBeNull();
  });

  test('one warning with a ready keys.origins object', () => {
    const issue = randomHostIssue([
      { origin: 'https://pr-4821.ci.example.com', base: true },
      { origin: 'https://api-pr-4821.ci.example.com', base: false },
    ]);
    expect(issue?.code).toBe('CHECK_RANDOM_HOST');
    expect(issue?.hint).toContain(
      "{ 'https://api-pr-*.ci.example.com': 'api', 'https://pr-*.ci.example.com': '' }",
    );
  });
});

describe('04-AC-45 estimate of the start banner (04-REQ-66)', () => {
  test('10 test runs in 100 s give 10 s per test; without a report 30 s per test', () => {
    const report = {
      startedAt: '2026-11-21T10:00:00.000Z',
      finishedAt: '2026-11-21T10:01:40.000Z',
      tests: { status: 'passed' as const, expected: 8, unexpected: 1, flaky: 1, skipped: 4 },
    };
    expect(msPerTest(report)).toBe(10_000);
    expect(
      msPerTest({ ...report, tests: { ...report.tests, expected: 0, unexpected: 0, flaky: 0 } }),
    ).toBeNull();
    expect(startEstimate({ tests: 4, passes: 5, msPerTest: 10_000 })).toBe(
      '≈ 4 min (from the last run)',
    );
    expect(startEstimate({ tests: 4, passes: 5, msPerTest: null })).toBe(
      '≈ 10 min (30 s per test, no earlier run)',
    );
  });

  test('the check estimate repeats the setup projects in every pass (04-REQ-51)', () => {
    expect(
      estimateText({
        tests: 10,
        passesTest: 5,
        passesThresholds: 10,
        meanMs: 6000,
        setupMs: 60_000,
      }),
    ).toBe(
      'measurement run ≈ 10 min (10 tests × 5 passes × 6.0 s), thresholds run ≈ 20 min (× 10 passes), 1 worker',
    );
  });
});

describe('04-AC-35 estimate and output', () => {
  test('N 214, R 5, m 6.2 s, S 0 is 1 h 51 min; no measured test is not available', () => {
    expect(
      estimateText({ tests: 214, passesTest: 5, passesThresholds: 10, meanMs: 6200, setupMs: 0 }),
    ).toBe(
      'measurement run ≈ 1 h 51 min (214 tests × 5 passes × 6.2 s), thresholds run ≈ 3 h 42 min (× 10 passes), 1 worker',
    );
    expect(
      estimateText({ tests: 10, passesTest: 5, passesThresholds: 10, meanMs: null, setupMs: 0 }),
    ).toBe('not available (no measured test ran)');
  });

  test('the output of a golden data set equals the golden console file at width 120', () => {
    const data: CheckSummary = {
      packageName: 'pw-perf',
      ran: 10,
      selected: 214,
      passed: 10,
      failed: 0,
      skippedByCheck: 204,
      projects: [
        {
          name: 'E2E',
          role: 'measured',
          browserName: 'chromium',
          baseURL: 'https://pr-4821.ci.example.com',
          requests: 312,
          tests: 10,
        },
        {
          name: 'setup',
          role: 'dependency',
          browserName: 'chromium',
          baseURL: null,
          requests: 0,
          tests: 0,
        },
      ],
      removedProjects: ['API', 'smoke-eu', 'smoke-us'],
      reporters: { kept: ['dot', 'pw-perf'], replaced: ['list'], removed: ['html', 'junit'] },
      requests: 312,
      apiKeys: 17,
      stepKeys: 0,
      origins: [
        { origin: 'https://pr-4821.ci.example.com', label: '', requests: 214, source: 'baseURL' },
        {
          origin: 'https://api-pr-4821.ci.example.com',
          label: 'api-pr-4821.ci.example.com',
          requests: 98,
          source: 'host',
        },
      ],
      topKeys: [
        { kind: 'api', key: 'GET /api/session', samples: 20, tests: 10 },
        { kind: 'api', key: 'GET api-pr-4821.ci.example.com/v1/catalog', samples: 18, tests: 9 },
      ],
      thresholdsFiles: [{ kind: 'api', name: 'pw-perf-thresholds.json', state: 'missing' }],
      warnings: [
        randomHostIssue([
          { origin: 'https://pr-4821.ci.example.com', base: true },
          { origin: 'https://api-pr-4821.ci.example.com', base: false },
        ]) ?? { code: 'X', message: '' },
      ],
      toolErrors: [],
      estimate: estimateText({
        tests: 214,
        passesTest: 5,
        passesThresholds: 10,
        meanMs: 6200,
        setupMs: 0,
      }),
    };
    const text = formatCheckSummary(data, { width: 120, color: false });
    const file = join(import.meta.dirname, '../../golden/console/check.w120.txt');
    if (process.env.GOLDEN_UPDATE === '1') writeFileSync(file, text);
    expect(text).toBe(readFileSync(file, 'utf8'));
  });
});

describe('check in the mode contract (04-REQ-48, 04-REQ-49)', () => {
  test('PW_PERF_MODE=check and PW_PERF_MAX_TESTS', () => {
    expect(readModeState({ PW_PERF_MODE: 'check', PW_PERF_MAX_TESTS: '3' })).toEqual({
      ok: true,
      value: { mode: 'check', maxTests: 3 },
    });
    const bad = readModeState({ PW_PERF_MODE: 'check', PW_PERF_MAX_TESTS: '1001' });
    expect(bad.ok ? [] : bad.issues.map((i) => i.code)).toEqual(['MODE_INVALID_VALUE']);
  });
});
