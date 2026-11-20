// withPerf(): the Playwright config wrapper (01, chapter 4.4; ADR-0002, ADR-0006, ADR-0007).
import type { PlaywrightTestConfig } from '@playwright/test';
import { resolveConfig } from '../core/config/index.ts';
import type { PerfConfigInput } from '../core/config/index.ts';
import { ConfigError } from '../core/types/index.ts';
import { readModeState } from '../mode/index.ts';
import { setRegistered } from '../registry/index.ts';
import { reporterEntryPath } from './reporter-path.ts';
import { planPerfRun } from './run-conditions.ts';
import { version } from '../../package.json';

/**
 * Wraps the Playwright config. Outside perf mode it returns `config` itself and does nothing
 * else (01-REQ-08, P-02). In perf mode it resolves the package config, registers it for the
 * reporter and the fixtures of this process and returns a copy of `config` with the run
 * conditions of perf mode; invalid config or mode variables throw ConfigError before any test
 * runs. No I/O, no randomness: the result depends only on the arguments and the environment, so
 * it is the same in the main process and in the workers (01-REQ-09).
 */
export function withPerf<T extends PlaywrightTestConfig>(
  config: T,
  perfConfig?: PerfConfigInput,
): T {
  const mode = readModeState(process.env);
  if (!mode.ok) throw new ConfigError(mode.issues);
  if (mode.value === null) return config;
  const state = mode.value;

  const resolved = resolveConfig(perfConfig, {
    mode: state.mode,
    ...(state.repeat === undefined ? {} : { repeat: state.repeat }),
    ...(state.env === undefined ? {} : { env: state.env }),
  });
  if (!resolved.ok) throw new ConfigError(resolved.issues);
  const { config: perf, snapshot, warnings } = resolved.value;

  const plan = planPerfRun(config, {
    projects: perf.run.projects,
    keepReporters: perf.run.keepReporters,
    repeat: perf.run.repeat[state.mode],
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
    warnings: [...warnings, ...plan.value.warnings],
  });
  return plan.value.config;
}
