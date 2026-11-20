// The Playwright reporter of the package (01, chapter 4.6). A thin adapter: it builds the run
// session from the registry and the process, and guards every hook, because Playwright swallows
// errors thrown in reporter methods (01-REQ-16). Outside perf mode it does nothing (P-02).
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import {
  directoryOf,
  readCiInfo,
  readHostInfo,
  relativeSlashPath,
  removeFileSync,
  resolvePath,
  writeJsonStable,
  writeTextAtomic,
} from '../io/index.ts';
import { loadThresholds, thresholdsFilePaths } from '../io/index.ts';
import { getRegistered } from '../registry/index.ts';
import { RunSession, runSettings } from './session.ts';
import type { ReporterHost } from './types.ts';
import { version } from '../../package.json';

function processHost(): ReporterHost {
  const env = process.env;
  return {
    env,
    io: {
      loadThresholds,
      thresholdsFilePaths,
      writeJsonStable,
      writeTextAtomic,
      resolvePath,
      directoryOf,
      relativeSlashPath,
      removeFileSync,
    },
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
    argv: process.argv,
    now: () => new Date(),
    random: Math.random,
    ci: readCiInfo(env),
    host: readHostInfo(env),
  };
}

export class PerfReporter implements Reporter {
  /** Reporter options from the Playwright config; none are defined yet. */
  readonly options: Record<string, unknown>;
  private readonly session: RunSession | null;
  private readonly startError: unknown;

  constructor(options: Record<string, unknown> = {}) {
    this.options = options;
    let session: RunSession | null = null;
    let startError: unknown;
    try {
      const host = processHost();
      const settings = runSettings(getRegistered(), host.env, version);
      session = settings === null ? null : new RunSession(host, settings);
    } catch (error) {
      startError = error;
    }
    this.session = session;
    this.startError = startError;
    if (startError !== undefined) {
      process.stderr.write(
        `playwright-performance-regression: REPORTER_INTERNAL_ERROR: the reporter could not start: ${startError instanceof Error ? startError.message : String(startError)}\n`,
      );
    }
  }

  onBegin(config: FullConfig, suite: Suite): void {
    const session = this.session;
    if (session === null) return;
    try {
      session.begin(config, suite);
    } catch (error) {
      session.recordInternalError('onBegin', error);
    }
  }

  onTestBegin(): void {
    this.session?.testBegin();
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const session = this.session;
    if (session === null) return;
    try {
      session.testEnd(test, result);
    } catch (error) {
      session.recordInternalError('onTestEnd', error);
    }
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | undefined> {
    if (this.session === null) return undefined;
    return this.session.end(result);
  }

  printsToStdio(): boolean {
    // Kept false on purpose (01, chapter 4.6): Playwright keeps its progress reporter.
    return false;
  }
}
