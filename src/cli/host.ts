// What the commands need from the process: streams, environment, clock, files and the Playwright
// process. The Node implementation is in node-host.ts; tests pass fakes (04, chapter 6: I/O and
// spawn only at the edge).

export interface Stream {
  write(text: string): unknown;
  isTTY?: boolean;
  columns?: number;
}

export type ForwardedSignal = 'SIGINT' | 'SIGTERM';

/** The Playwright child process as the CLI uses it. */
export interface ChildProcessLike {
  kill(signal?: NodeJS.Signals): boolean;
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
}

export interface SpawnOptions {
  cwd: string;
  env: Record<string, string>;
  stdio: 'inherit';
  shell: false;
}

export interface PlaywrightInstall {
  /** Absolute path of the Playwright CLI script (`bin.playwright` of @playwright/test). */
  cliPath: string;
  version: string;
}

export interface PathHelpers {
  join: (a: string, b: string) => string;
  resolve: (a: string, b: string) => string;
  dirname: (path: string) => string;
}

/** One entry of a directory listing. */
export interface DirEntry {
  name: string;
  directory: boolean;
}

export interface CliHost {
  cwd: string;
  paths: PathHelpers;
  env: Readonly<Record<string, string | undefined>>;
  platform: string;
  /** os.tmpdir(): directory of the outcome file (04-REQ-11). */
  tmpdir: string;
  stdout: Stream;
  stderr: Stream;
  now(): Date;
  random(): number;
  packageVersion: string;
  /** Lowest supported @playwright/test version (D-07). */
  minPlaywrightVersion: string;
  /** Absolute path of the package reporter entry point (04-REQ-15). */
  reporterPath: string;
  /** @playwright/test resolved from `dir`, or null when it is not installed there (V-03). */
  resolvePlaywright(dir: string): PlaywrightInstall | null;
  /** child_process.spawn(process.execPath, args, options). */
  spawnNode(args: string[], options: SpawnOptions): ChildProcessLike;
  /** Registers a signal handler; returns the function that removes it. */
  onSignal(signal: ForwardedSignal, handler: () => void): () => void;
  /** Text of a file, or null when it does not exist. */
  readText(path: string): Promise<string | null>;
  removeFile(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  isDirectory(path: string): Promise<boolean>;
  /** Imports a module by file URL (package config files). */
  importModule(url: string): Promise<unknown>;
  /** Entries of a directory; empty when it does not exist. */
  listDir(path: string): Promise<DirEntry[]>;
}
