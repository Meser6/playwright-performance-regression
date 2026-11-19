// Fake CLI host: captured streams, a scripted Playwright child process and signal handlers.
import { EventEmitter } from 'node:events';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type {
  ChildProcessLike,
  CliHost,
  ForwardedSignal,
  SpawnOptions,
} from '../../../src/cli/host.ts';
import * as io from '../../../src/io/index.ts';

export class FakeChild extends EventEmitter implements ChildProcessLike {
  readonly kills: (NodeJS.Signals | undefined)[] = [];

  kill(signal?: NodeJS.Signals): boolean {
    this.kills.push(signal);
    return true;
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit('exit', code, signal);
  }
}

export interface FakeHost {
  host: CliHost;
  stdout: string[];
  stderr: string[];
  spawned: { args: string[]; options: SpawnOptions }[];
  child: FakeChild;
  signals: Map<ForwardedSignal, (() => void)[]>;
  /** Sends a signal to the CLI. */
  signal(name: ForwardedSignal): void;
  advance(ms: number): void;
  /** Directory @playwright/test was resolved from. */
  resolvedFrom?: string;
}

export interface FakeHostOptions {
  cwd: string;
  env?: Record<string, string>;
  /** null: @playwright/test is not installed. */
  playwright?: { cliPath: string; version: string } | null;
  /** Called when Playwright is started: the script of the run (write the outcome, exit). */
  onSpawn?: (fake: FakeHost, options: SpawnOptions) => void;
  platform?: string;
  directories?: string[];
  reporterPath?: string;
  importModule?: (url: string) => Promise<unknown>;
}

export function fakeCliHost(options: FakeHostOptions): FakeHost {
  let time = Date.UTC(2026, 10, 18, 10, 0, 0);
  const signals = new Map<ForwardedSignal, (() => void)[]>();
  const fake: FakeHost = {
    stdout: [],
    stderr: [],
    spawned: [],
    child: new FakeChild(),
    signals,
    signal: (name) => {
      for (const handler of [...(signals.get(name) ?? [])]) handler();
    },
    advance: (ms) => {
      time += ms;
    },
    host: undefined as unknown as CliHost,
  };
  fake.host = {
    cwd: options.cwd,
    paths: { join, resolve, dirname },
    env: options.env ?? {},
    platform: options.platform ?? 'linux',
    tmpdir: join(options.cwd, 'tmp'),
    stdout: { write: (t: string) => fake.stdout.push(t) },
    stderr: { write: (t: string) => fake.stderr.push(t) },
    now: () => new Date(time),
    random: () => 0.0408,
    packageVersion: '1.2.3',
    minPlaywrightVersion: '1.57.0',
    reporterPath: options.reporterPath ?? '/pkg/dist/reporter.js',
    resolvePlaywright: (dir) => {
      fake.resolvedFrom = dir;
      return options.playwright === undefined
        ? { cliPath: '/project/node_modules/@playwright/test/cli.js', version: '1.57.0' }
        : options.playwright;
    },
    spawnNode: (args, spawnOptions) => {
      fake.spawned.push({ args, options: spawnOptions });
      setImmediate(() => options.onSpawn?.(fake, spawnOptions));
      return fake.child;
    },
    onSignal: (signal, handler) => {
      signals.set(signal, [...(signals.get(signal) ?? []), handler]);
      return () => {
        signals.set(
          signal,
          (signals.get(signal) ?? []).filter((h) => h !== handler),
        );
      };
    },
    readText: io.readTextFile,
    removeFile: (path) => rm(path, { force: true }),
    exists: io.fileExists,
    isDirectory: async (path) => (options.directories ?? []).includes(path),
    importModule: options.importModule ?? ((url) => import(url)),
  };
  return fake;
}
