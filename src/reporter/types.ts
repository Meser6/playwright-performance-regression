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
import type { PackageInfo } from '../io/package-info.ts';
import type { ThresholdsLocation } from '../io/thresholds.ts';

export type ProjectLike = Pick<FullProject, 'name' | 'repeatEach' | 'retries' | 'dependencies'> & {
  teardown?: string | undefined;
  use: {
    browserName?: string | undefined;
    defaultBrowserType?: string | undefined;
    baseURL?: string | undefined;
    launchOptions?: { slowMo?: number | undefined } | undefined;
  };
};

export type ConfigLike = Pick<FullConfig, 'rootDir' | 'workers' | 'maxFailures' | 'version'> & {
  configFile?: string | undefined;
  /** Reporters of the run, for the check output (04-REQ-50). */
  reporter?: FullConfig['reporter'];
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
  /** TestResult.errors, to tell a crashed worker (09-REQ-34). */
  errors?: readonly { message?: string | undefined }[];
  /** TestResult.duration, for the estimate of a check (04-REQ-51). */
  duration?: number;
  /** Top-level steps (06-REQ-16); optional so that tests can omit it. */
  steps?: readonly StepLike[];
};

export type RootSuiteLike = {
  allTests(): TestLike[];
  /**
   * Project suites of the run: the projects the test command selects and their dependencies
   * (04-REQ-18). Optional so that tests can omit it; without it every config project is in the run.
   */
  suites?: readonly { project(): { name: string } | undefined }[];
};

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
  /** Nearest package.json scripts and lock files (09-REQ-32). */
  readPackageInfo(dir: string): PackageInfo;
  /** A path in the temporary directory (04-REQ-49). */
  tempPath(name: string): string;
  /** Text of a file, null when missing (pass files, 02-REQ-36). */
  readTextFile(path: string): Promise<string | null>;
  /** Text of a file, null when missing or unreadable (previous report, 04-REQ-66). */
  readTextFileSync(path: string): string | null;
  /** Entry names of a directory, empty when missing (02-REQ-36). */
  listDirSync(dir: string): string[];
  /** Whether a directory exists at the path (04-REQ-71). */
  isDirectorySync(path: string): boolean;
  /** The path with symbolic links resolved (04-REQ-71). */
  realPathSync(path: string): string;
  /** Home directory of the user (04-REQ-71). */
  homeDir(): string;
  /** Every entry under a directory, relative; null above `limit` entries (04-REQ-71). */
  scanDirSync(dir: string, limit: number): string[] | null;
  /** Removes the contents of a directory and keeps it (04-REQ-71). */
  emptyDirSync(dir: string): void;
}

/** How a pass process ended (04-REQ-64). */
export interface PassExitLike {
  code: number | null;
  signal: string | null;
  error?: string;
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
  /** Uniform random number in [0, 1), for a run id without PW_PERF_RUN_ID. */
  random(): number;
  /** CI and host metadata of the run (02-REQ-28). */
  ci: RunReport['ci'];
  host: RunReport['host'];
  /** process.execPath, for the command of the next pass (04-REQ-63). */
  execPath: string;
  /** Runs one pass and waits for it (04-REQ-64). */
  runPass(
    command: { file: string; args: readonly string[] },
    env: Readonly<Record<string, string | undefined>>,
  ): Promise<PassExitLike>;
}
