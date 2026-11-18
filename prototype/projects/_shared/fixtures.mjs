// Minimal collector: context override with a request tracker, test-scoped auto buffer that
// drains trackers and attaches the samples as JSON.
//
// Environment knobs (read in the worker):
//   PROTO_DRAIN_MS         max wait for in-flight requests (default 0)
//   PROTO_DRAIN_WHERE      "context" (default): drain in the context override teardown, before
//                          the built-in context closes; "buffer": drain in the _perfBuffer
//                          teardown, i.e. after the built-in context closed
//   PROTO_BUDGET=1         cap the wait by the remaining test time minus 1000 ms
//   PROTO_TEARDOWN_SLEEP_MS  extra sleep in the _perfBuffer teardown
//   PROTO_SYNTH_SAMPLES    add N synthetic samples to the attachment (attachment size check)
import { test as base } from '@playwright/test';
import { performance } from 'node:perf_hooks';
import { getRegistered } from './registry.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = (name, def) => (process.env[name] === undefined ? def : process.env[name]);

export function createTracker(context, label = 'context') {
  const inflight = new Map();
  const samples = [];
  const work = new Set();
  let accepting = true;
  const onRequest = (req) => {
    if (!accepting) return;
    if (!/^https?:/.test(req.url())) return;
    inflight.set(req, { t0: performance.now() });
  };
  const finish = async (req, failed) => {
    const st = inflight.get(req);
    if (!st) return;
    const nodeMs = performance.now() - st.t0;
    const timing = req.timing();
    let status = 'FAILED';
    let fromServiceWorker = false;
    if (!failed) {
      const resp = await req.response();
      status = resp ? resp.status() : 'NO_RESPONSE';
      fromServiceWorker = resp ? resp.fromServiceWorker() : false;
    }
    samples.push({
      label,
      method: req.method(),
      url: req.url(),
      resourceType: req.resourceType(),
      status,
      failureText: failed ? (req.failure()?.errorText ?? null) : null,
      timing,
      duration: !failed && timing.responseEnd >= 0 ? +timing.responseEnd.toFixed(1) : null,
      requestStart: timing.requestStart >= 0 ? +timing.requestStart.toFixed(1) : null,
      ttfb:
        timing.responseStart >= 0 && timing.requestStart >= 0
          ? +(timing.responseStart - timing.requestStart).toFixed(1)
          : null,
      nodeMs: +nodeMs.toFixed(1),
      timeSource: failed ? 'browser' : timing.responseEnd >= 0 ? 'browser' : 'node',
      fromServiceWorker,
      settledAt: Date.now(),
    });
    inflight.delete(req);
  };
  const track = (p) => {
    const q = p.catch((e) => samples.push({ label, collectorError: String(e) })).finally(() => work.delete(q));
    work.add(q);
  };
  const onFinished = (r) => track(finish(r, false));
  const onFailed = (r) => track(finish(r, true));
  context.on('request', onRequest);
  context.on('requestfinished', onFinished);
  context.on('requestfailed', onFailed);
  return {
    samples,
    inflight,
    async drain(budgetMs) {
      accepting = false;
      const deadline = performance.now() + Math.max(0, budgetMs);
      while ((inflight.size || work.size) && performance.now() < deadline) await sleep(5);
      for (const [req] of inflight) {
        samples.push({ label, method: req.method(), url: req.url(), status: 'PENDING' });
      }
      inflight.clear();
      context.off('request', onRequest);
      context.off('requestfinished', onFinished);
      context.off('requestfailed', onFailed);
    },
  };
}

function synthetic(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      method: 'GET',
      url: `http://127.0.0.1:3000/api/orders/${100000 + i}/items?page=${i % 7}&sort=desc`,
      resourceType: i % 3 ? 'fetch' : 'xhr',
      startTime: 1763460000000 + i * 3,
      status: 200,
      failureText: null,
      duration: 12.3 + (i % 50),
      requestStart: 0.4,
      ttfb: 10.1 + (i % 40),
      timeSource: 'browser',
      fromServiceWorker: false,
    });
  }
  return out;
}

export const test = base.extend({
  _perfBuffer: [
    async ({}, use, testInfo) => {
      const t0 = performance.now();
      const buffer = { trackers: [], t0, events: [] };
      await use(buffer);
      const where = env('PROTO_DRAIN_WHERE', 'context');
      const drainMs = Number(env('PROTO_DRAIN_MS', '0'));
      let budget = drainMs;
      if (env('PROTO_BUDGET', '0') === '1' && testInfo.timeout > 0) {
        budget = Math.max(0, Math.min(drainMs, testInfo.timeout - (performance.now() - t0) - 1000));
      }
      if (where === 'buffer') {
        const d0 = performance.now();
        for (const t of buffer.trackers) await t.drain(budget);
        buffer.events.push({ drainedIn: 'buffer', budget, waitedMs: +(performance.now() - d0).toFixed(1) });
      }
      const sleepMs = Number(env('PROTO_TEARDOWN_SLEEP_MS', '0'));
      if (sleepMs) await sleep(sleepMs);
      const samples = buffer.trackers.flatMap((t) => t.samples);
      const n = Number(env('PROTO_SYNTH_SAMPLES', '0'));
      if (n) samples.push(...synthetic(n));
      const meta = {
        pid: process.pid,
        workerIndex: testInfo.workerIndex,
        registry: getRegistered() ?? null,
        timeoutSeenInTeardown: testInfo.timeout,
        events: buffer.events,
      };
      const s0 = performance.now();
      const body = JSON.stringify({ meta, samples });
      meta.stringifyMs = +(performance.now() - s0).toFixed(2);
      const a0 = performance.now();
      // Re-serialise with the timing fields filled in (cheap compared to the first pass).
      const finalBody = body.replace('"meta":{', `"meta":{"stringifyMs":${meta.stringifyMs},"tAttached":${Date.now()},`);
      await testInfo.attach('pw-perf-samples', { body: finalBody, contentType: 'application/json' });
      const attachMs = performance.now() - a0;
      if (process.env.PROTO_LOG_ATTACH === '1') console.log(`attachMs=${attachMs.toFixed(2)} bytes=${finalBody.length}`);
    },
    { auto: true },
  ],
  context: async ({ context, _perfBuffer }, use, testInfo) => {
    const tracker = createTracker(context);
    _perfBuffer.trackers.push(tracker);
    await use(context);
    if (env('PROTO_DRAIN_WHERE', 'context') === 'context') {
      const d0 = performance.now();
      const drainMs = Number(env('PROTO_DRAIN_MS', '0'));
      let budget = drainMs;
      if (env('PROTO_BUDGET', '0') === '1' && testInfo.timeout > 0) {
        const elapsed = performance.now() - _perfBuffer.t0;
        budget = Math.max(0, Math.min(drainMs, testInfo.timeout - elapsed - 1000));
      }
      await tracker.drain(budget);
      _perfBuffer.events.push({ drainedIn: 'context', budget, waitedMs: +(performance.now() - d0).toFixed(1) });
    }
  },
});

export { expect } from '@playwright/test';
