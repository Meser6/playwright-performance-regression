// Fake Playwright objects and a host for the reporter session (no Playwright run). Files go to a
// temporary directory through the real io functions.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig } from '../../../src/core/config/index.ts';
import type { PerfConfigInput } from '../../../src/core/config/index.ts';
import { SAMPLES_ATTACHMENT_NAME } from '../../../src/core/types/index.ts';
import type { RawRequestSample, SampleBatch } from '../../../src/core/types/index.ts';
import * as io from '../../../src/io/index.ts';
import type { PerfModeState } from '../../../src/mode/index.ts';
import type { RegisteredState } from '../../../src/registry/index.ts';
import { RunSession, runSettings } from '../../../src/reporter/session.ts';
import type { SessionOptions } from '../../../src/reporter/session.ts';
import type {
  ConfigLike,
  ProjectLike,
  ReporterHost,
  ResultLike,
  SuiteLike,
  TestLike,
} from '../../../src/reporter/types.ts';

export const HOST_INFO = {
  platform: 'linux',
  arch: 'x64',
  nodeVersion: 'v22.20.0',
  ci: false,
  cpuCount: 4,
  cpuModel: 'Test CPU',
};

export interface Captured {
  host: ReporterHost;
  stdout: string[];
  stderr: string[];
  /** Passes started through host.runPass, with their environment. */
  passes: {
    command: { file: string; args: readonly string[] };
    env: Record<string, string | undefined>;
  }[];
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'pw-perf-reporter-'));
}

export function fakeHost(
  dir: string,
  options: {
    start?: number;
    random?: number;
    env?: Record<string, string>;
    tty?: number;
    argv?: string[];
    /** What a started pass does; by default it exits with 0 and writes nothing. */
    runPass?: ReporterHost['runPass'];
  } = {},
): Captured {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const passes: Captured['passes'] = [];
  let time = options.start ?? Date.UTC(2026, 10, 18, 10, 0, 0);
  return {
    stdout,
    stderr,
    passes,
    host: {
      env: options.env ?? {},
      argv: options.argv ?? ['node', 'playwright', 'test'],
      io,
      stdout: {
        write: (t: string) => stdout.push(t),
        isTTY: options.tty !== undefined,
        columns: options.tty,
      },
      stderr: { write: (t: string) => stderr.push(t) },
      cwd: dir,
      now: () => new Date((time += 1000)),
      random: () => options.random ?? 0.5,
      ci: null,
      host: { ...HOST_INFO },
      execPath: '/usr/bin/node',
      runPass: async (command, env) => {
        passes.push({ command, env: { ...env } });
        return options.runPass === undefined
          ? { code: 0, signal: null }
          : options.runPass(command, env);
      },
    },
  };
}

export function registered(
  input: PerfConfigInput,
  mode: PerfModeState,
  measured: string[] = ['chromium'],
): RegisteredState {
  // One pass unless a test asks for more (D-39): passes 2…N start processes.
  const withPasses = {
    ...input,
    run: { ...input.run, passes: { test: 1, thresholds: 1, ...input.run?.passes } },
  };
  const resolved = resolveConfig(withPasses, {
    mode: mode.mode === 'check' ? 'test' : mode.mode,
    ...(mode.env === undefined ? {} : { env: mode.env }),
  });
  if (!resolved.ok) throw new Error(JSON.stringify(resolved.issues));
  return {
    config: resolved.value.config,
    snapshot: resolved.value.snapshot,
    mode,
    packageVersion: '0.0.0-test',
    measuredProjects: measured,
    runConditions: {
      overridden: ['trace'],
      removedProjects: ['firefox'],
      removedReporters: [],
      replacedReporters: ['list'],
    },
    warnings: [],
  };
}

export function project(name: string, extra: Partial<ProjectLike> = {}): ProjectLike {
  return {
    name,
    repeatEach: 1,
    retries: 0,
    dependencies: [],
    use: { baseURL: 'http://app.test' },
    ...extra,
  };
}

export function fakeConfig(dir: string, extra: Partial<ConfigLike> = {}): ConfigLike {
  return {
    rootDir: dir,
    configFile: join(dir, 'playwright.config.ts'),
    workers: 1,
    maxFailures: 0,
    version: '1.57.0',
    shard: null,
    projects: [project('chromium')],
    ...extra,
  };
}

let ids = 0;

export interface FakeTestOptions {
  title?: string;
  project?: string;
  repeatEachIndex?: number;
  outcome?: ReturnType<TestLike['outcome']>;
  expectedStatus?: TestLike['expectedStatus'];
  /** Test file name under tests/; cart.spec.ts by default. */
  file?: string;
  /** test.id; a new one by default. */
  id?: string;
}

export function fakeTest(dir: string, options: FakeTestOptions = {}): TestLike {
  const projectName = options.project ?? 'chromium';
  const file: SuiteLike = {
    title: options.file ?? 'cart.spec.ts',
    type: 'file',
    project: () => ({ name: projectName }),
  };
  const describe: SuiteLike = {
    title: 'cart',
    type: 'describe',
    parent: file,
    project: () => ({ name: projectName }),
  };
  return {
    id: options.id ?? `t${++ids}`,
    title: options.title ?? 'adds an item',
    repeatEachIndex: options.repeatEachIndex ?? 0,
    expectedStatus: options.expectedStatus ?? 'passed',
    location: { file: join(dir, 'tests', options.file ?? 'cart.spec.ts'), line: 7, column: 3 },
    parent: describe,
    outcome: () => options.outcome ?? 'expected',
  };
}

export function request(
  path: string,
  duration: number,
  extra: Partial<RawRequestSample> = {},
): RawRequestSample {
  return {
    duration,
    fromServiceWorker: false,
    method: 'GET',
    requestStart: 1,
    resourceType: 'fetch',
    startTime: 1763460000000,
    status: 200,
    timeSource: 'browser',
    ttfb: Math.round(duration * 5) / 10,
    url: `http://app.test${path}`,
    ...extra,
  };
}

export function batch(requests: RawRequestSample[], extra: Partial<SampleBatch> = {}): SampleBatch {
  return {
    schemaVersion: 2,
    collector: { browserName: 'chromium', name: 'playwright-js', version: '0.0.0' },
    requests,
    diagnostics: [],
    ...extra,
  };
}

export function result(
  batches: (SampleBatch | string)[],
  extra: Partial<ResultLike> = {},
): ResultLike {
  return {
    status: 'passed',
    retry: 0,
    startTime: new Date(Date.UTC(2026, 10, 18, 10, 0, 0, 0)),
    attachments: batches.map((b) => ({
      name: SAMPLES_ATTACHMENT_NAME,
      contentType: 'application/json',
      body: Buffer.from(typeof b === 'string' ? b : JSON.stringify(b)),
    })),
    ...extra,
  };
}

export function session(
  captured: Captured,
  state: RegisteredState | undefined,
  options: SessionOptions = {},
): RunSession {
  const settings = runSettings(state, captured.host.env, '0.0.0-test');
  if (settings === null) throw new Error('perf mode is off');
  return new RunSession(captured.host, settings, options);
}

/** `count` passing tests, each with one request per path and duration `ms(i)`. */
export function runTests(
  s: RunSession,
  dir: string,
  count: number,
  paths: string[],
  ms: (i: number, path: string) => number,
  options: FakeTestOptions = {},
): TestLike[] {
  const tests: TestLike[] = [];
  for (let i = 0; i < count; i++) {
    const test = fakeTest(dir, { repeatEachIndex: i % 5, ...options });
    s.testBegin();
    s.testEnd(test, result([batch(paths.map((p) => request(p, ms(i, p))))]));
    tests.push(test);
  }
  return tests;
}
