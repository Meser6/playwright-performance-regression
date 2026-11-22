// Passes with real processes (D-39, 04 chapter 4.12): `PW_PERF_MODE=test npm run e2e` runs the
// whole script (with its setup step) once per pass, the first pass merges the pass files, and
// `pw-perf test --passes` takes the same way. Needs `pnpm build`, Chromium and npm.
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { parseRunReport } from '../../src/core/schema/index.ts';
import type { RunReport } from '../../src/core/types/index.ts';
import { RUN_TIMEOUT, startHarness } from './harness.ts';
import type { Harness } from './harness.ts';

let harness: Harness;
let dir = '';

beforeAll(async () => {
  harness = await startHarness();
  dir = harness.copy('passes');
  // The `playwright` command of the scripts, as `npm install` would link it.
  const bin = join(dir, 'node_modules', '.bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    join(bin, 'playwright'),
    '#!/bin/sh\nexec node "$(dirname "$0")/../@playwright/test/cli.js" "$@"\n',
  );
  chmodSync(join(bin, 'playwright'), 0o755);
  writeFileSync(join(bin, 'playwright.cmd'), '@node "%~dp0\\..\\@playwright\\test\\cli.js" %*\r\n');
});

afterAll(async () => {
  await harness?.close();
});

interface Run {
  status: number | null;
  output: string;
  report: RunReport | null;
}

/** Runs `file args` in the project copy with a clean environment (no PW_PERF_* or npm_*). */
function run(file: string, args: string[], env: Record<string, string>): Promise<Run> {
  for (const old of ['pw-perf-results', 'test-results', 'prep.log']) {
    rmSync(join(dir, old), { recursive: true, force: true });
  }
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('PW_PERF_') && !name.toLowerCase().startsWith('npm_'),
    ),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: dir,
      env: { ...clean, CI: '', NO_COLOR: '1', BASE_URL: harness.server.url, ...env },
      shell: process.platform === 'win32' && !file.endsWith('.exe'),
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (status) => {
      const path = join(dir, 'pw-perf-results', 'report.json');
      let report: RunReport | null = null;
      if (existsSync(path)) {
        const parsed = parseRunReport(readFileSync(path, 'utf8'), path);
        if (!parsed.ok) return reject(new Error(JSON.stringify(parsed.issues)));
        report = parsed.value;
      }
      resolve({ status, output, report });
    });
  });
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const prepRuns = (): number =>
  existsSync(join(dir, 'prep.log'))
    ? readFileSync(join(dir, 'prep.log'), 'utf8').split('\n').filter(Boolean).length
    : 0;
const passRunIds = (): string[] =>
  readdirSync(join(dir, 'pw-perf-results'))
    .filter((f) => /^pass-\d+\.json$/u.test(f))
    .sort()
    .map(
      (f) =>
        (JSON.parse(readFileSync(join(dir, 'pw-perf-results', f), 'utf8')) as { runId: string })
          .runId,
    );

describe('passes of the test script (04-REQ-63, 04-REQ-64)', () => {
  test(
    '04-AC-42 PW_PERF_MODE=test npm run e2e runs the script with its setup step once per pass',
    async () => {
      const result = await run(npm, ['run', 'e2e', '--', '--grep', 'cart'], {
        PW_PERF_MODE: 'test',
      });
      expect(result.status, result.output).toBe(0);
      expect(prepRuns(), result.output).toBe(3);
      const report = result.report;
      expect(report?.passes).toEqual({ planned: 3, completed: 3, failed: [] });
      // --grep cart reached every pass: one test, three times.
      expect(report?.tests).toMatchObject({ expected: 3, unexpected: 0 });
      expect(report?.endpoints['GET /api/cart']?.count).toBe(3);
      expect(report?.endpoints['GET /api/items/:id']).toBeUndefined();
      expect(new Set(passRunIds())).toEqual(new Set([report?.runId]));
      expect(passRunIds()).toHaveLength(3);
      expect(result.output).toMatch(/pass 2\/3: starting .*run e2e -- --grep cart/u);
      expect(result.output).toContain('Tests     1 test × 3 passes = 3 test runs');
      expect(
        JSON.parse(readFileSync(join(dir, 'pw-perf-results', 'outcome.json'), 'utf8')).exitCode,
      ).toBe(0);
    },
    RUN_TIMEOUT,
  );

  test(
    '04-AC-43 a setup step that fails in the second run gives RUN_PASS_FAILED and 2 of 3 passes',
    async () => {
      const result = await run(npm, ['run', 'e2e'], { PW_PERF_MODE: 'test', PREP_FAIL_AT: '2' });
      expect(prepRuns(), result.output).toBe(3);
      expect(result.report?.passes).toEqual({ planned: 3, completed: 2, failed: [2] });
      expect(result.report?.tests.expected).toBe(4);
      expect(result.report?.warnings.map((w) => w.code)).toContain('RUN_PASS_FAILED');
      expect(result.status, result.output).toBe(0);
    },
    RUN_TIMEOUT,
  );

  // pnpm passes the arguments after the script name without "--" (04-REQ-63).
  const pnpm = process.env['npm_execpath'] ?? '';
  test.skipIf(!/pnpm/u.test(pnpm))(
    '04-AC-42 the same run through pnpm',
    async () => {
      const result = await run(process.execPath, [pnpm, 'run', 'e2e', '--grep', 'cart'], {
        PW_PERF_MODE: 'test',
        PW_PERF_PASSES: '2',
      });
      expect(result.status, result.output).toBe(0);
      expect(prepRuns(), result.output).toBe(2);
      expect(result.report?.passes).toEqual({ planned: 2, completed: 2, failed: [] });
      expect(result.report?.tests.expected).toBe(2);
    },
    RUN_TIMEOUT,
  );
});
