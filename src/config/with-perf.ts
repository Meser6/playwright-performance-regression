// withPerf(): the Playwright config wrapper (01, chapter 4.4; ADR-0002, ADR-0006, ADR-0007).
import type { PlaywrightTestConfig } from '@playwright/test';
import { resolveConfig } from '../core/config/index.ts';
import type { PerfConfigInput } from '../core/config/index.ts';
import { ConfigError } from '../core/types/index.ts';
import { PACKAGE_NAME } from '../core/types/index.ts';
import type { Issue } from '../core/types/index.ts';
import { RUN_ID_ENV, argvWarnings, generateRunId, readModeState } from '../mode/index.ts';
import { setRegistered } from '../registry/index.ts';
import { reporterEntryPath } from './reporter-path.ts';
import { planPerfRun } from './run-conditions.ts';
import { version } from '../../package.json';

/**
 * Wraps the Playwright config. Outside perf mode it returns `config` itself and does nothing
 * else (01-REQ-08, P-02). In perf mode it resolves the package config, registers it for the
 * reporter and the fixtures of this process and returns a copy of `config` with the run
 * conditions of perf mode; invalid config or mode variables throw ConfigError before any test
 * runs. The returned config depends only on the arguments and the environment, so it is the same
 * in the main process and in the workers (01-REQ-09). Only in the main process of the
 * environment mode (no CLI) it sets PW_PERF_RUN_ID for the workers and warns about arguments
 * (04-REQ-60, 04-REQ-61).
 */
export function withPerf<T extends PlaywrightTestConfig>(
  config: T,
  perfConfig?: PerfConfigInput,
): T {
  const first = readModeState(process.env);
  if (!first.ok) throw new ConfigError(first.issues);
  if (first.value === null) return config;
  const argvIssues = mainProcessSetup(first.value.outcomeFile === undefined);
  const mode = readModeState(process.env);
  if (!mode.ok || mode.value === null) throw new Error('withPerf: the mode state changed');
  const state = mode.value;

  // A check runs every test once; the config is resolved as for a measurement run (04-REQ-48).
  const check = state.mode === 'check';
  const resolved = resolveConfig(perfConfig, {
    mode: state.mode === 'check' ? 'test' : state.mode,
    ...(state.repeat === undefined || check ? {} : { repeat: state.repeat }),
    ...(state.env === undefined ? {} : { env: state.env }),
  });
  if (!resolved.ok) throw new ConfigError(resolved.issues);
  const { config: perf, snapshot, warnings } = resolved.value;

  const plan = planPerfRun(config, {
    projects: perf.run.projects,
    keepReporters: perf.run.keepReporters,
    repeat: state.mode === 'check' ? 1 : perf.run.repeat[state.mode],
    reporterPath: reporterEntryPath(),
  });
  if (!plan.ok) throw new ConfigError(plan.issues);

  setRegistered({
    config: perf,
    snapshot,
    mode: state,
    packageVersion: version,
    measuredProjects: plan.value.measuredProjects,
    runConditions: plan.value.runConditions,
    warnings: [...warnings, ...plan.value.warnings, ...argvIssues],
  });
  return plan.value.config;
}

/** Set once per process: the config may be loaded more than once in the main process. */
const SETUP_DONE = Symbol.for('playwright-performance-regression.mainProcessSetup');

/**
 * Main process of the environment mode (04-REQ-60, 04-REQ-61): a run id for the workers and the
 * argument warnings on stderr. Returns the warnings that also go to the report. Workers
 * (TEST_WORKER_INDEX set) and runs through the CLI do nothing.
 */
function mainProcessSetup(environmentMode: boolean): Issue[] {
  if (!environmentMode || process.env.TEST_WORKER_INDEX !== undefined) return [];
  const store = globalThis as Record<symbol, Issue[] | undefined>;
  const done = store[SETUP_DONE];
  if (done !== undefined) return done;
  if ((process.env[RUN_ID_ENV] ?? '') === '') {
    process.env[RUN_ID_ENV] = generateRunId(new Date(), Math.random);
  }
  const found = argvWarnings(process.argv, PACKAGE_NAME);
  const report: Issue[] = [];
  for (const issue of [found.reporter, found.unsupported]) {
    if (issue === null) continue;
    process.stderr.write(
      `${PACKAGE_NAME}: warning ${issue.code}: ${issue.message}\n  Hint: ${issue.hint}\n`,
    );
  }
  if (found.unsupported !== null) report.push(found.unsupported);
  store[SETUP_DONE] = report;
  return report;
}
