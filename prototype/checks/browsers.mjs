// V-08 timing() across engines, V-09 draining in-flight requests in teardown,
// V-12 (a) CORS preflight in Chromium and (e) failure texts of aborted requests.
import { join } from 'node:path';
import { prepare, runPlaywright, samplesOf, testEnds } from '../lib.mjs';

// The Firefox build bundled with Playwright 1.57.0 (firefox-1497) does not start on the
// verification host (macOS 27): launch times out. Firefox is checked on the latest version only.
const browserProjects = (version) =>
  (version === '1.57.0' ? ['chromium', 'webkit'] : ['chromium', 'firefox', 'webkit']).flatMap((b) => ['--project', b]);
const TIMING_FIELDS = ['domainLookupStart', 'domainLookupEnd', 'connectStart', 'connectEnd', 'requestStart', 'responseStart', 'responseEnd'];

const kOf = (s) => new URL(s.url).searchParams.get('k');
const q = (xs, p) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? +a[Math.min(a.length - 1, Math.floor(p * (a.length - 1) + 0.5))].toFixed(1) : null;
};
const summary = (xs) => ({ n: xs.length, min: q(xs, 0), median: q(xs, 0.5), p90: q(xs, 0.9), max: q(xs, 1) });

async function run(version, srv, grep, env = {}, extra = []) {
  const dir = prepare(version, 'browsers');
  return runPlaywright(dir, ['-g', grep, ...extra], {
    env: { PROTO_BASE: srv.base, PROTO_BASE2: srv.base2, PW_PERF_MODE: 'test', ...env },
    outFile: join(dir, 'out.jsonl'),
  });
}

export async function v08(version, srv) {
  const r = await run(version, srv, 'V-08', { PROTO_DRAIN_MS: '1000' }, browserProjects(version));
  const out = { exitCode: r.code, projects: browserProjects(version).filter((x) => x !== '--project') };
  for (const t of testEnds(r)) {
    const samples = (samplesOf(t)?.samples ?? []).filter((s) => kOf(s)?.startsWith('v08-'));
    const minusOne = Object.fromEntries(
      TIMING_FIELDS.map((f) => [f, samples.filter((s) => s.timing?.[f] === -1).length]),
    );
    out[t.project] = {
      status: t.status,
      duration: summary(samples.filter((s) => s.duration != null).map((s) => s.duration)),
      ttfb: summary(samples.filter((s) => s.ttfb != null).map((s) => s.ttfb)),
      requestStart: summary(samples.filter((s) => s.requestStart != null).map((s) => s.requestStart)),
      nodeMs: summary(samples.filter((s) => s.nodeMs != null).map((s) => s.nodeMs)),
      statuses: samples.map((s) => s.status).filter((x) => x !== 200),
      timeSourceNode: samples.filter((s) => s.timeSource === 'node').length,
      ttfbNull: samples.filter((s) => s.ttfb === null).length,
      timingMinusOneCounts: minusOne,
      exampleTiming: samples[0]?.timing ?? null,
    };
  }
  return out;
}

export async function v12a(version, srv) {
  const before = srv.log.length;
  const r = await run(version, srv, 'V-12a', { PROTO_DRAIN_MS: '1000' }, ['--project', 'chromium']);
  const t = testEnds(r)[0];
  const samples = samplesOf(t)?.samples ?? [];
  const pick = (prefix) => samples.filter((s) => kOf(s)?.startsWith(prefix) && s.method === 'GET');
  return {
    exitCode: r.code,
    status: t?.status,
    requestEventsWithMethodOPTIONS: samples.filter((s) => s.method === 'OPTIONS').length,
    optionsHitsOnServer: srv.log.slice(before).filter((l) => l.method === 'OPTIONS').length,
    serverDelays: { preflightMs: 300, getMs: 100 },
    preflighted: pick('preflight').map((s) => ({ duration: s.duration, requestStart: s.requestStart, ttfb: s.ttfb, timing: s.timing })),
    simpleCrossOrigin: pick('simple').map((s) => ({ duration: s.duration, requestStart: s.requestStart, ttfb: s.ttfb })),
  };
}

export async function v12e(version, srv) {
  const r = await run(version, srv, 'V-12e', { PROTO_DRAIN_MS: '1500' }, browserProjects(version));
  const out = { exitCode: r.code, projects: browserProjects(version).filter((x) => x !== '--project') };
  for (const t of testEnds(r)) {
    const samples = samplesOf(t)?.samples ?? [];
    const byCase = {};
    for (const s of samples) {
      const k = kOf(s);
      if (!k) continue;
      byCase[k] = { status: s.status, failureText: s.failureText ?? null };
    }
    out[t.project] = { status: t.status, errors: t.errors, cases: byCase };
  }
  return out;
}

export async function v09(version, srv) {
  const variants = {
    'drain in context override, budget 500 ms': { PROTO_DRAIN_MS: '500', PROTO_DRAIN_WHERE: 'context' },
    'drain in context override, budget 5000 ms': { PROTO_DRAIN_MS: '5000', PROTO_DRAIN_WHERE: 'context' },
    'drain in _perfBuffer after built-in context closed, budget 5000 ms': { PROTO_DRAIN_MS: '5000', PROTO_DRAIN_WHERE: 'buffer' },
    'drain in context override, budget 5000 ms capped by test timeout 2500 ms (05-REQ-27)': {
      PROTO_DRAIN_MS: '5000',
      PROTO_DRAIN_WHERE: 'context',
      PROTO_BUDGET: '1',
      timeout: '2500',
    },
  };
  const out = {};
  for (const [name, { timeout, ...env }] of Object.entries(variants)) {
    const r = await run(version, srv, 'V-09', env, ['--project', 'chromium', ...(timeout ? ['--timeout', timeout] : [])]);
    const t = testEnds(r)[0];
    const a = samplesOf(t);
    const s = (a?.samples ?? []).find((x) => kOf(x) === 'v09');
    const u = (a?.samples ?? []).find((x) => kOf(x) === 'v09-body-unread');
    out[name] = {
      sampleBodyUnread: u ? { status: u.status, failureText: u.failureText ?? null, duration: u.duration ?? null } : null,
      exitCode: r.code,
      testStatus: t?.status,
      testDurationMs: t?.duration,
      errors: t?.errors,
      drain: a?.meta?.events,
      sample: s ? { status: s.status, failureText: s.failureText ?? null, duration: s.duration ?? null } : null,
    };
  }
  return out;
}
