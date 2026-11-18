// V-12 (b) per-project workers overridden by the config copy, (c) fixture teardown inside the
// test timeout, (d) removing projects keeps dependencies and teardowns of the measured ones.
import { join } from 'node:path';
import { prepare, runPlaywright, samplesOf, testEnds } from '../lib.mjs';

async function run(version, srv, scenario, env = {}, args = []) {
  const dir = prepare(version, 'conditions');
  return runPlaywright(dir, args, {
    env: { PROTO_BASE: srv.base, PW_PERF_MODE: 'test', PROTO_SCENARIO: scenario, ...env },
    outFile: join(dir, 'out.jsonl'),
  });
}

function maxOverlap(tests) {
  const points = tests.flatMap((t) => [
    [t.startTime, 1],
    [t.startTime + t.duration, -1],
  ]);
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cur = 0;
  let max = 0;
  for (const [, d] of points) max = Math.max(max, (cur += d));
  return max;
}

export async function v12b(version, srv) {
  const out = {};
  for (const [name, env] of Object.entries({
    'config as written (project workers: 4, no override)': { PW_PERF_MODE: '', PROTO_KEEP_WORKERS: '1' },
    'global workers 1, project workers 4 left as is': { PROTO_KEEP_WORKERS: 'project' },
    'withPerf copy: workers 1 globally and in the project': {},
  })) {
    const r = await run(version, srv, 'workers', env);
    const tests = testEnds(r);
    const begin = r.events.find((e) => e.ev === 'begin');
    out[name] = {
      exitCode: r.code,
      configWorkers: begin?.workers,
      projectWorkersInFullProject: begin?.projects.map((p) => p.workers ?? '(not exposed)'),
      maxConcurrentTests: maxOverlap(tests),
      distinctWorkers: new Set(tests.map((t) => t.workerIndex)).size,
      wallMs: r.wallMs,
      runningLine: r.stdout.split('\n').find((l) => l.startsWith('Running')),
    };
  }
  return out;
}

export async function v12c(version, srv) {
  const cases = {
    'timeout 2000: body 500 + teardown 1000': [{ PROTO_BODY_MS: '500', PROTO_TEARDOWN_SLEEP_MS: '1000' }, '2000', 'body and teardown'],
    'timeout 2000: body 1500 + teardown 1000 (each fits, sum does not)': [
      { PROTO_BODY_MS: '1500', PROTO_TEARDOWN_SLEEP_MS: '1000' },
      '2000',
      'body and teardown',
    ],
    'timeout 2000: body 500 + teardown 3000': [{ PROTO_BODY_MS: '500', PROTO_TEARDOWN_SLEEP_MS: '3000' }, '2000', 'body and teardown'],
    'timeout 3000: body 1000 + request in flight, wait min(5000, remaining - 1000)': [
      { PROTO_BODY_MS: '1000', PROTO_WITH_REQUEST: '1', PROTO_DRAIN_MS: '5000', PROTO_BUDGET: '1' },
      '3000',
      'request in flight',
    ],
    'timeout 3000: body 1000 + request in flight, wait 5000 without the cap': [
      { PROTO_BODY_MS: '1000', PROTO_WITH_REQUEST: '1', PROTO_DRAIN_MS: '5000' },
      '3000',
      'request in flight',
    ],
  };
  const out = {};
  for (const [name, [env, timeout, grep]] of Object.entries(cases)) {
    const r = await run(version, srv, 'timeout', env, ['--timeout', timeout, '-g', grep]);
    const t = testEnds(r)[0];
    const a = samplesOf(t);
    out[name] = {
      exitCode: r.code,
      testStatus: t?.status,
      testDurationMs: t?.duration,
      errors: t?.errors,
      attachmentPresent: Boolean(a),
      drain: a?.meta?.events ?? null,
      timeoutSeenInTeardown: a?.meta?.timeoutSeenInTeardown ?? null,
      pendingSample: (a?.samples ?? []).find((s) => s.url.includes('k=v12c'))?.status ?? null,
    };
  }
  return out;
}

export async function v12d(version, srv) {
  const out = {};
  const r = await run(version, srv, 'deps', { PROTO_MEASURED: 'measured' });
  const begin = r.events.find((e) => e.ev === 'begin');
  out['measured = "measured"'] = {
    exitCode: r.code,
    projectsInRun: begin?.projects.map((p) => p.name),
    executed: testEnds(r).map((t) => `${t.project}:${t.status}`),
    order: testEnds(r).map((t) => t.project),
  };
  const r2 = await run(version, srv, 'deps', { PROTO_MEASURED: 'measured' }, ['--project', 'other']);
  out['--project other (removed)'] = {
    exitCode: r2.code,
    error: (r2.stderr + r2.stdout).split('\n').filter((l) => /project/i.test(l)).slice(0, 2).join(' | '),
  };
  const r3 = await run(version, srv, 'deps', { PROTO_MEASURED: 'measured' }, ['--project', 'measured']);
  out['--project measured'] = {
    exitCode: r3.code,
    executed: testEnds(r3).map((t) => `${t.project}:${t.status}`),
  };
  return out;
}
