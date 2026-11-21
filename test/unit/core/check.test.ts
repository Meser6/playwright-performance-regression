// The check mode: random hosts, the estimate and the output (04-REQ-50 – 04-REQ-52).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { estimateText, proposePattern, randomHostIssue } from '../../../src/core/check/index.ts';
import { formatCheckSummary } from '../../../src/console/check-summary.ts';
import type { CheckSummary } from '../../../src/console/check-summary.ts';
import { parseArgs } from '../../../src/cli/parse.ts';
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

describe('04-AC-35 estimate and output', () => {
  test('N 214, R 5, m 6.2 s, S 0 is 1 h 51 min; no measured test is not available', () => {
    expect(
      estimateText({ tests: 214, repeatTest: 5, repeatThresholds: 10, meanMs: 6200, setupMs: 0 }),
    ).toBe(
      'measurement run ≈ 1 h 51 min (214 tests × 5 repeats × 6.2 s), thresholds run ≈ 3 h 42 min (× 10 repeats), 1 worker',
    );
    expect(
      estimateText({ tests: 10, repeatTest: 5, repeatThresholds: 10, meanMs: null, setupMs: 0 }),
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
        repeatTest: 5,
        repeatThresholds: 10,
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

describe('check in the CLI and the mode contract (04-REQ-48, 04-REQ-49)', () => {
  test('pw-perf check --max-tests; --repeat and --prune are refused', () => {
    const ok = parseArgs(['check', '--max-tests', '2', '--grep', '@perf']);
    expect(ok.ok && ok.value).toMatchObject({
      kind: 'run',
      mode: 'check',
      maxTests: 2,
      playwrightArgs: ['--grep', '@perf'],
    });
    for (const bad of [
      ['check', '--repeat', '3'],
      ['check', '--prune'],
      ['test', '--max-tests', '2'],
      ['check', '--max-tests', '0'],
    ]) {
      const result = parseArgs(bad);
      expect(result.ok ? [] : result.issues.map((i) => i.code), bad.join(' ')).toEqual([
        'CLI_INVALID_OPTION',
      ]);
    }
  });

  test('PW_PERF_MODE=check and PW_PERF_MAX_TESTS', () => {
    expect(readModeState({ PW_PERF_MODE: 'check', PW_PERF_MAX_TESTS: '3' })).toEqual({
      ok: true,
      value: { mode: 'check', maxTests: 3 },
    });
    const bad = readModeState({ PW_PERF_MODE: 'check', PW_PERF_MAX_TESTS: '1001' });
    expect(bad.ok ? [] : bad.issues.map((i) => i.code)).toEqual(['MODE_INVALID_VALUE']);
  });
});
