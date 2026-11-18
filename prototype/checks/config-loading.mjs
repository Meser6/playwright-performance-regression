// V-01 registry filled in workers, V-02 package config transpiled by Playwright,
// V-03 Playwright CLI found from the project directory.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';
import { firstLine, prepare, resolvePlaywrightCli, runPlaywright, samplesOf, testEnds } from '../lib.mjs';

const CONFIGS = {
  'esm-ts': ['playwright.plain.config.ts', 'playwright.noext.config.ts', 'playwright.alias.config.ts'],
  'cjs-js': [
    'playwright.plain.config.ts',
    'playwright.noext.config.ts',
    'playwright.alias.config.ts',
    'playwright.js-noext.config.js',
    'playwright.js-ext.config.js',
  ],
};

export async function v01v02(version, srv) {
  const runs = [];
  for (const [project, configs] of Object.entries(CONFIGS)) {
    const dir = prepare(version, project);
    for (const config of configs) {
      for (const perf of [true, false]) {
        const r = await runPlaywright(dir, ['-c', config], {
          env: { PROTO_BASE: srv.base, ...(perf ? { PW_PERF_MODE: 'test' } : { PW_PERF_MODE: '' }) },
          outFile: join(dir, 'out.jsonl'),
        });
        const begin = r.events.find((e) => e.ev === 'begin');
        const workerRegistries = testEnds(r).map((t) => samplesOf(t)?.meta?.registry ?? null);
        const workerPids = [...new Set(testEnds(r).map((t) => samplesOf(t)?.meta?.pid))];
        runs.push({
          project,
          config,
          perfMode: perf,
          exitCode: r.code,
          tests: testEnds(r).map((t) => t.status),
          mainRegistry: begin?.registry ?? null,
          workerRegistriesEqualMain:
            workerRegistries.length > 0 && workerRegistries.every((w) => isDeepStrictEqual(w, begin?.registry ?? null)),
          mainPid: begin?.pid ?? null,
          workerPids,
          error: r.code === 0 ? null : firstLine(r.stderr) || r.stdout.split('\n').filter((l) => /Error|error/.test(l)).slice(0, 3).join(' | '),
        });
      }
    }
  }
  return runs;
}

export function v03(version) {
  const out = {};
  const dir = prepare(version, 'esm-ts');
  out.fromProjectRoot = resolvePlaywrightCli(dir);
  mkdirSync(join(dir, 'nested', 'deeper'), { recursive: true });
  out.fromSubdirectory = resolvePlaywrightCli(join(dir, 'nested', 'deeper')).cliPath === out.fromProjectRoot.cliPath;
  // Directory without @playwright/test anywhere above it.
  const lonely = join(tmpdir(), `pw-perf-proto-no-pw-${process.pid}`);
  mkdirSync(lonely, { recursive: true });
  try {
    resolvePlaywrightCli(lonely);
    out.notInstalled = 'unexpectedly resolved';
  } catch (e) {
    out.notInstalled = { code: e.code, message: firstLine(e.message) };
  }
  rmSync(lonely, { recursive: true, force: true });
  return out;
}

export async function v03Spawn(version, srv) {
  // A project path with a space, run with process.execPath + bin, no shell.
  const dir = prepare(version, 'esm-ts', 'esm ts with space');
  const r = await runPlaywright(dir, ['-c', 'playwright.plain.config.ts'], {
    env: { PROTO_BASE: srv.base },
    outFile: join(dir, 'out.jsonl'),
  });
  return { exitCode: r.code, passed: testEnds(r).filter((t) => t.status === 'passed').length };
}
