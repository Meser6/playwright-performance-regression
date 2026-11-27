// Sharded perf runs and the merge with real Playwright processes (17, chapter 14): two shards of
// the "sharding" project in separate copies, their shard files copied to a third copy, and
// `PW_PERF_MODE=merge npx pw-perf` there, in thresholds mode and in test mode with a slower key.
// Needs `pnpm build` and Chromium.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { parseOutcome, parseRunReport } from '../../src/core/schema/index.ts';
import type { Outcome, RunReport } from '../../src/core/types/index.ts';
import { ROOT, RUN_TIMEOUT, startHarness } from './harness.ts';
import type { Harness } from './harness.ts';

const REPORTS = 'reports/pw-perf';
let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
  await control({ delays: { 'GET /api/a': 60, 'GET /api/b': 60, 'GET /api/shared': 60 } });
}, RUN_TIMEOUT);

afterAll(async () => {
  await harness?.close();
}, RUN_TIMEOUT);

/** Sets the delays of the demo server (POST /__control). */
async function control(body: unknown): Promise<void> {
  const response = await fetch(`${harness.server.url}/__control`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
}

/** A copy of the project: each shard runs in its own directory, like on its own machine. */
function clone(name: string): string {
  return harness.copy('sharding', undefined, `sharding ${name}`);
}

function readJson<T>(path: string, parse: (text: string, path: string) => unknown): T {
  const parsed = parse(readFileSync(path, 'utf8'), path) as
    { ok: true; value: T } | { ok: false; issues: unknown };
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.value;
}

const report = (dir: string): RunReport =>
  readJson<RunReport>(join(dir, REPORTS, 'report.json'), parseRunReport);
const outcome = (dir: string): Outcome =>
  readJson<Outcome>(join(dir, REPORTS, 'outcome.json'), parseOutcome);

/** Runs the binary in `dir` with PW_PERF_MODE=merge (and `args`). */
function merge(
  dir: string,
  args: string[] = [],
): Promise<{ status: number | null; output: string }> {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('PW_PERF_')),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, 'dist/cli.js'), ...args], {
      cwd: dir,
      env: { ...clean, CI: '', NO_COLOR: '1', PW_PERF_MODE: 'merge' },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, output }));
  });
}

/** Copies the shard files of `from` into reports/pw-perf/ of `to`. */
function collect(to: string, ...from: string[]): void {
  mkdirSync(join(to, REPORTS), { recursive: true });
  for (const dir of from) {
    for (const name of readdirSync(join(dir, REPORTS)).filter((n) => n.startsWith('shard-'))) {
      cpSync(join(dir, REPORTS, name), join(to, REPORTS, name));
    }
  }
}

describe('17 sharded runs', () => {
  test(
    '17-AC-01 17-AC-08 a shard of examples/with-setup writes its shard file with both passes, no report',
    async () => {
      const dir = harness.copy('with-setup', join(ROOT, 'examples'));
      const run = await harness.run(dir, {
        env: { PW_PERF_MODE: 'test', PW_PERF_PASSES: '2' },
        args: ['--shard=1/2'],
      });
      expect(run.status, run.output).toBe(0);
      const file = JSON.parse(readFileSync(join(dir, REPORTS, 'shard-1-of-2.json'), 'utf8')) as {
        passes: { completed: number };
        entries: unknown[];
      };
      expect(file.passes.completed).toBe(2);
      expect(file.entries.length).toBeGreaterThan(0);
      expect(run.outcome?.exitCode).toBe(0);
      expect(run.report).toBeNull();
      expect(existsSync(join(dir, REPORTS, 'junit.xml'))).toBe(false);
      expect(existsSync(join(dir, 'pw-perf-thresholds.json'))).toBe(false);
      expect(run.output).toContain('pw-perf · measurement run · shard 1/2');
      expect(run.output).toContain(
        'Next: when all 2 shards are done, run PW_PERF_MODE=merge npx pw-perf in the merge job',
      );
      expect(run.output).not.toContain('RUN_SHARDED');
    },
    RUN_TIMEOUT,
  );

  test(
    '17-AC-02 a shard without tests (--shard=3/3 with 2 test files) writes empty entries',
    async () => {
      const dir = clone('empty');
      const run = await harness.run(dir, {
        env: { PW_PERF_MODE: 'test', PW_PERF_PASSES: '1' },
        args: ['--shard=3/3'],
      });
      const file = JSON.parse(readFileSync(join(dir, REPORTS, 'shard-3-of-3.json'), 'utf8')) as {
        entries: unknown[];
      };
      expect(file.entries, run.output).toEqual([]);
      // Playwright gives an empty shard no project suites: no CONFIG_NO_MEASURED_PROJECT.
      expect(run.output).not.toContain('CONFIG_NO_MEASURED_PROJECT');
      expect(run.outcome?.exitCode, run.output).toBe(0);
    },
    RUN_TIMEOUT,
  );

  test(
    '17-AC-05 17-AC-04 thresholds and a measurement merged from two shards; a missing shard writes no thresholds',
    async () => {
      const s1 = clone('s1');
      const s2 = clone('s2');
      const m = clone('merge');
      const shards = async (mode: string): Promise<void> => {
        for (const [dir, shard] of [
          [s1, '1/2'],
          [s2, '2/2'],
        ] as const) {
          const run = await harness.run(dir, {
            env: { PW_PERF_MODE: mode, PW_PERF_PASSES: '3' },
            args: [`--shard=${shard}`],
          });
          expect(run.status, run.output).toBe(0);
          expect(run.outcome?.exitCode, run.output).toBe(0);
        }
        rmSync(join(m, REPORTS), { recursive: true, force: true });
        collect(m, s1, s2);
      };

      // 17-AC-05: one complete thresholds file from both shards.
      await shards('thresholds');
      const thresholds = await merge(m);
      expect(thresholds.status, thresholds.output).toBe(0);
      expect(thresholds.output).toContain('merged from 2 shards');
      const file = JSON.parse(readFileSync(join(m, 'pw-perf-thresholds.json'), 'utf8')) as {
        entries: Record<string, unknown>;
      };
      // GET /page comes from shard 1 and shard 2, the API keys from one or both.
      expect(Object.keys(file.entries).sort()).toEqual([
        'GET /api/a',
        'GET /api/b',
        'GET /api/shared',
        'GET /page',
      ]);
      expect(existsSync(join(m, REPORTS, 'thresholds-diff.md'))).toBe(true);
      const written = readFileSync(join(m, 'pw-perf-thresholds.json'), 'utf8');

      rmSync(join(m, REPORTS, 'shard-2-of-2.json'));
      const missing = await merge(m);
      expect(missing.status, missing.output).toBe(3);
      expect(missing.output).toContain('MERGE_SHARD_MISSING');
      expect(report(m).shards?.missing).toEqual([2]);
      expect(readFileSync(join(m, 'pw-perf-thresholds.json'), 'utf8')).toBe(written);

      // 17-AC-04: a slower key in the measurement fails the merged run with exit code 2.
      await control({ delays: { 'GET /api/a': 400, 'GET /api/b': 60, 'GET /api/shared': 60 } });
      try {
        await shards('test');
      } finally {
        await control({ delays: { 'GET /api/a': 60, 'GET /api/b': 60, 'GET /api/shared': 60 } });
      }
      const measured = await merge(m);
      expect(measured.status, measured.output).toBe(2);
      expect(measured.output).toContain('Outcome: performance failed (code 2) in');
      expect(outcome(m).exitCode).toBe(2);
      const merged = report(m);
      expect(merged.shards?.total).toBe(2);
      expect(merged.shards?.list.map((s) => s.index)).toEqual([1, 2]);
      expect(merged.endpoints['GET /api/a']?.evaluation.result).toBe('fail');
      // 17-AC-11: the shared key has one cold sample per shard.
      expect(merged.endpoints['GET /api/shared']?.cold?.count).toBe(2);
      expect(readFileSync(join(m, REPORTS, 'report.html'), 'utf8')).toContain(
        '<h3 id="shards-h">Shards</h3>',
      );
      const junit = readFileSync(join(m, REPORTS, 'junit.xml'), 'utf8');
      expect(junit).toMatch(/name="GET \/api\/a"[^>]*>\s*<failure/u);
    },
    RUN_TIMEOUT * 3,
  );

  test(
    '17-AC-07 merge in the test command is MODE_INVALID_VALUE; an argument to the merge is CLI_UNKNOWN_COMMAND',
    async () => {
      const dir = clone('mode');
      const run = await harness.run(dir, { env: { PW_PERF_MODE: 'merge' } });
      expect(run.status, run.output).toBe(1);
      expect(run.output).toContain('MODE_INVALID_VALUE');
      expect(run.output).toContain('merge runs without tests: PW_PERF_MODE=merge npx pw-perf');
      expect(run.results).toEqual([]);
      const withArgument = await merge(dir, ['merge']);
      expect(withArgument.status).toBe(3);
      expect(withArgument.output).toContain('CLI_UNKNOWN_COMMAND');
      expect(existsSync(join(dir, REPORTS, 'outcome.json'))).toBe(false);
    },
    RUN_TIMEOUT,
  );
});
