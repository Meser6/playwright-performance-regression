// V-04: cost of large sample attachments (worker -> main process IPC, reporter, HTML report).
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { prepare, runPlaywright, samplesOf, testEnds } from '../lib.mjs';

const SIZES = [0, 1000, 5000, 20000];
const med = (xs) => {
  const a = xs.filter((x) => x != null).sort((x, y) => x - y);
  return a.length ? a[Math.floor((a.length - 1) / 2)] : null;
};
function dirBytes(dir) {
  let total = 0;
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      total += e.isDirectory() ? dirBytes(p) : statSync(p).size;
    }
  } catch {
    return null;
  }
  return total;
}

export async function v04(version) {
  const out = { testsPerRun: 5, sampleShape: 'one request sample of the 02 format, ~280 bytes as JSON' };
  for (const html of [false, true]) {
    for (const n of SIZES) {
      const dir = prepare(version, 'volume');
      const r = await runPlaywright(dir, [], {
        env: { PW_PERF_MODE: 'test', PROTO_SYNTH_SAMPLES: String(n), PROTO_HTML: html ? '1' : '0' },
        outFile: join(dir, 'out.jsonl'),
      });
      const tests = testEnds(r);
      const a = tests.map(samplesOf);
      const begin = r.events.find((e) => e.ev === 'begin');
      const end = r.events.find((e) => e.ev === 'end');
      out[`${html ? 'dot+html' : 'dot'} / ${n} samples per test`] = {
        exitCode: r.code,
        passed: tests.filter((t) => t.status === 'passed').length,
        attachmentBytesPerTest: med(a.map((x) => x?.bytes)),
        workerStringifyMsMedian: med(a.map((x) => x?.meta?.stringifyMs)),
        attachToOnTestEndMsMedian: med(a.map((x) => x?.recvLagMs)),
        attachToOnTestEndMsMax: Math.max(...a.map((x) => x?.recvLagMs ?? 0)),
        reporterParseMsMedian: med(a.map((x) => x?.parseMs)),
        onBeginToOnEndMs: begin && end ? end.t - begin.t : null,
        processWallMs: r.wallMs,
        htmlReportBytes: html ? dirBytes(join(dir, 'html-report')) : null,
      };
    }
  }
  return out;
}
