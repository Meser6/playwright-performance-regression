// Recording reporter: appends one JSON line per event to $PROTO_OUT.
import { appendFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const KEY = Symbol.for('pw-perf-prototype.registry');
const out = (ev) => {
  if (process.env.PROTO_OUT) appendFileSync(process.env.PROTO_OUT, JSON.stringify(ev) + '\n');
};

export default class RecordingReporter {
  constructor(options) {
    out({ ev: 'construct', pid: process.pid, options: options ?? null, t: Date.now() });
  }
  printsToStdio() {
    return false;
  }
  onBegin(config, suite) {
    out({
      ev: 'begin',
      pid: process.pid,
      t: Date.now(),
      version: config.version,
      workers: config.workers,
      projects: config.projects.map((p) => ({
        name: p.name,
        repeatEach: p.repeatEach,
        retries: p.retries,
        dependencies: p.dependencies,
        teardown: p.teardown ?? null,
        workers: p.workers,
      })),
      testCount: suite.allTests().length,
      registry: globalThis[KEY] ?? null,
    });
  }
  onTestEnd(test, result) {
    const tRecv = Date.now();
    const attachments = result.attachments.map((a) => {
      const info = { name: a.name, contentType: a.contentType, bytes: a.body?.length ?? null, path: a.path ?? null };
      if (a.name === 'pw-perf-samples' && a.body) {
        const t0 = performance.now();
        const parsed = JSON.parse(a.body.toString('utf8'));
        info.parseMs = +(performance.now() - t0).toFixed(2);
        info.meta = parsed.meta;
        info.sampleCount = parsed.samples.length;
        if (parsed.samples.length <= 200) info.samples = parsed.samples;
        info.recvLagMs = parsed.meta?.tAttached ? tRecv - parsed.meta.tAttached : null;
      }
      return info;
    });
    out({
      ev: 'testEnd',
      t: tRecv,
      title: test.title,
      project: test.parent.project()?.name ?? null,
      status: result.status,
      duration: result.duration,
      workerIndex: result.workerIndex,
      parallelIndex: result.parallelIndex,
      startTime: result.startTime.getTime(),
      errors: result.errors.map((e) => (e.message ?? '').split('\n')[0].slice(0, 300)),
      attachments,
    });
  }
  onEnd(result) {
    out({ ev: 'end', t: Date.now(), status: result.status });
    const forced = process.env.PROTO_ONEND_STATUS;
    return forced ? { status: forced } : undefined;
  }
}
