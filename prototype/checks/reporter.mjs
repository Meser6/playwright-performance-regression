// V-05 --reporter replaces config reporters and accepts an appended absolute path,
// V-06 onEnd status changes the exit code, V-10 attach in fixture teardown reaches onTestEnd,
// V-11 reporter calls with --list.
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { prepare, runPlaywright, samplesOf, testEnds } from '../lib.mjs';

const CONFIG = 'playwright.plain.config.ts';
const evNames = (r) => r.events.map((e) => e.ev);

export async function v05(version, srv) {
  const dir = prepare(version, 'esm-ts');
  const spaced = join(dir, 'reporter dir with space');
  mkdirSync(spaced, { recursive: true });
  cpSync(join(dir, '..', '_shared', 'reporter.mjs'), join(spaced, 'reporter.mjs'));
  const abs = join(spaced, 'reporter.mjs');
  const env = { PROTO_BASE: srv.base, PW_PERF_MODE: 'test' };
  const out = join(dir, 'out.jsonl');
  const cases = {
    'no flag (config: list + recording reporter)': [],
    '--reporter=dot (config reporters replaced?)': ['--reporter=dot'],
    '--reporter=list,<abs path with space>': [`--reporter=list,${abs}`],
    '--reporter list,<abs path with space> (two args)': ['--reporter', `list,${abs}`],
    '--reporter=dot --reporter=line,<abs> (repeated flag, path in last)': ['--reporter=dot', `--reporter=line,${abs}`],
    '--reporter=line,<abs> --reporter=dot (repeated flag, path in first)': [`--reporter=line,${abs}`, '--reporter=dot'],
  };
  const res = {};
  for (const [name, extra] of Object.entries(cases)) {
    const r = await runPlaywright(dir, ['-c', CONFIG, ...extra], { env, outFile: out });
    res[name] = {
      exitCode: r.code,
      recordingReporterEvents: [...new Set(evNames(r))],
      recordingReporterOptions: r.events.find((e) => e.ev === 'construct')?.options ?? null,
      listOutput: /✓/.test(r.stdout),
      dotOutput: /[·°]{2,}/.test(r.stdout),
      stdoutHead: r.stdout.split('\n').slice(0, 3).join(' | ').replaceAll(dir, '<project>'),
    };
  }
  return res;
}

export async function v06(version, srv) {
  const dir = prepare(version, 'esm-ts');
  const out = join(dir, 'out.jsonl');
  const base = { PROTO_BASE: srv.base, PW_PERF_MODE: 'test' };
  const cases = {
    'tests pass, onEnd returns failed': [{ PROTO_ONEND_STATUS: 'failed' }, ['basic.spec.ts']],
    'tests pass, onEnd returns nothing': [{}, ['basic.spec.ts']],
    'test fails, onEnd returns passed': [{ PROTO_ONEND_STATUS: 'passed', PROTO_EDGE: '1' }, ['edge.spec.ts', '-g', 'fails']],
    'test fails, onEnd returns nothing': [{ PROTO_EDGE: '1' }, ['edge.spec.ts', '-g', 'fails']],
    'tests pass, onEnd returns interrupted': [{ PROTO_ONEND_STATUS: 'interrupted' }, ['basic.spec.ts']],
    'tests pass, onEnd returns timedout': [{ PROTO_ONEND_STATUS: 'timedout' }, ['basic.spec.ts']],
  };
  const res = {};
  for (const [name, [env, args]] of Object.entries(cases)) {
    const r = await runPlaywright(dir, ['-c', CONFIG, ...args], { env: { ...base, ...env }, outFile: out });
    res[name] = {
      exitCode: r.code,
      tests: testEnds(r).map((t) => t.status),
      statusSeenInOnEnd: r.events.find((e) => e.ev === 'end')?.status,
    };
  }
  return res;
}

export async function v10(version, srv) {
  const dir = prepare(version, 'esm-ts');
  const r = await runPlaywright(dir, ['-c', CONFIG], {
    env: { PROTO_BASE: srv.base, PW_PERF_MODE: 'test', PROTO_EDGE: '1' },
    outFile: join(dir, 'out.jsonl'),
  });
  return testEnds(r).map((t) => ({
    title: t.title,
    status: t.status,
    attachmentInOnTestEnd: Boolean(samplesOf(t)),
    sampleCount: samplesOf(t)?.sampleCount ?? null,
    bodyBytes: samplesOf(t)?.bytes ?? null,
  }));
}

export async function v11(version, srv) {
  const dir = prepare(version, 'esm-ts');
  const out = join(dir, 'out.jsonl');
  const res = {};
  for (const [name, env] of Object.entries({
    '--list': {},
    '--list, onEnd returns failed': { PROTO_ONEND_STATUS: 'failed' },
  })) {
    const r = await runPlaywright(dir, ['-c', CONFIG, '--list'], {
      env: { PROTO_BASE: srv.base, PW_PERF_MODE: 'test', ...env },
      outFile: out,
    });
    res[name] = {
      exitCode: r.code,
      events: evNames(r),
      reporterConstructorOptions: r.events.find((e) => e.ev === 'construct')?.options ?? null,
      testCountInOnBegin: r.events.find((e) => e.ev === 'begin')?.testCount ?? null,
      statusInOnEnd: r.events.find((e) => e.ev === 'end')?.status ?? null,
    };
  }
  return res;
}
