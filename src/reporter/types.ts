// The parts of the Playwright reporter API the reporter uses, and the services it gets from the
// outside (files, clock, terminal). The run logic depends only on these, so unit tests feed it
// plain objects instead of a real Playwright run.
import type {
  FullConfig,
  FullProject,
  FullResult,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import type { LoadedThresholds } from '../core/evaluate/index.ts';
import type { Kind, RunReport } from '../core/types/index.ts';
import type { ThresholdsLocation } from '../io/thresholds.ts';

export type ProjectLike = Pick<FullProject, 'name' | 'repeatEach' | 'retries' | 'dependencies'> & {
  teardown?: string | undefined;
  use: {
    browserName?: string | undefined;
    defaultBrowserType?: string | undefined;
    baseURL?: string | undefined;
  };
};

export type ConfigLike = Pick<FullConfig, 'rootDir' | 'workers' | 'maxFailures' | 'version'> & {
  configFile?: string | undefined;
  shard: FullConfig['shard'];
  projects: ProjectLike[];
};

import type { StepLike } from './steps.ts';

export interface SuiteLike {
  title: string;
  type: Suite['type'];
  parent?: SuiteLike | undefined;
  project(): { name: string } | undefined;
}

export type TestLike = Pick<
  TestCase,
  'id' | 'title' | 'repeatEachIndex' | 'expectedStatus' | 'location'
> & {
  parent: SuiteLike;
  outcome(): ReturnType<TestCase['outcome']>;
};

export type ResultLike = Pick<TestResult, 'status' | 'retry' | 'startTime'> & {
  attachments: { name: string; contentType: string; body?: Buffer | undefined; path?: string }[];
  /** Top-level steps (06-REQ-16); optional so that tests can omit it. */
  steps?: readonly StepLike[];
};

export type RootSuiteLike = { allTests(): TestLike[] };

export type FullResultLike = Pick<FullResult, 'status'>;

/** Files and paths: src/io in the real reporter, fakes in unit tests. */
export interface ReporterIo {
  loadThresholds(location: ThresholdsLocation): Promise<LoadedThresholds>;
  thresholdsFilePaths(location: ThresholdsLocation): Record<Kind, string>;
  writeJsonStable(path: string, value: unknown): Promise<void>;
  writeTextAtomic(path: string, text: string): Promise<void>;
  resolvePath(base: string, path: string): string;
  directoryOf(path: string): string;
  relativeSlashPath(from: string, path: string): string;
  /** Removes a file if it exists (04-REQ-62). */
  removeFileSync(path: string): void;
}

/** Output stream as the reporter sees it. */
export interface OutputLike {
  write(text: string): unknown;
  isTTY?: boolean | undefined;
  columns?: number | undefined;
}

/** Everything the reporter takes from its process. */
export interface ReporterHost {
  env: Readonly<Record<string, string | undefined>>;
  io: ReporterIo;
  stdout: OutputLike;
  stderr: OutputLike;
  cwd: string;
  /** process.argv of the main Playwright process (04-REQ-35, 04-REQ-61). */
  argv: readonly string[];
  /** Wall clock. */
  now(): Date;
  /** Uniform random number in [0, 1), for a run id without the CLI. */
  random(): number;
  /** CI and host metadata of the run (02-REQ-28). */
  ci: RunReport['ci'];
  host: RunReport['host'];
}
