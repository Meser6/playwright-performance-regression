// Process registry (01, chapter 4.3; ADR-0007): hands the config resolved by withPerf() to the
// reporter and the fixtures of the same process. Symbol.for gives one slot even when the ESM and
// the CJS build of the package are both loaded (V-01).
import type { ResolvedConfig, ResolvedConfigJson } from '../core/config/index.ts';
import type { Issue } from '../core/types/index.ts';
import type { PerfModeState } from '../mode/index.ts';

export const REGISTRY_KEY: unique symbol = Symbol.for('pw-perf.registry');

/** What withPerf() changed in the Playwright config, for the reporter's info line (01-REQ-37). */
export interface RunConditions {
  /** Settings withPerf() changed from the user's values, e.g. "workers", "retries", "trace". */
  overridden: string[];
  /** Projects removed from the run (04-REQ-18). */
  removedProjects: string[];
  /** Reporters removed from the run (04-REQ-32). */
  removedReporters: string[];
}

export interface RegisteredState {
  config: ResolvedConfig;
  /** JSON form of `config` (report snapshot); also decides whether two registrations differ. */
  snapshot: ResolvedConfigJson;
  mode: PerfModeState;
  packageVersion: string;
  /** Names of measured projects (04-REQ-18); fixtures do not collect in other projects (05-REQ-21). */
  measuredProjects: string[];
  runConditions: RunConditions;
  /**
   * Warnings found by withPerf(), which may not print (01-REQ-09, it also runs in workers);
   * the reporter reports them.
   */
  warnings: Issue[];
}

interface RegistrySlot {
  state: RegisteredState | undefined;
  /** test objects returned by withPerfFixtures() (05-REQ-22). */
  wrappedTests: WeakSet<object>;
  /** Contexts registered with trackContext() in this worker (05-REQ-23). */
  trackedContexts: Set<object>;
}

function slot(): RegistrySlot {
  const global = globalThis as Record<symbol, unknown>;
  let current = global[REGISTRY_KEY] as RegistrySlot | undefined;
  if (current === undefined) {
    current = { state: undefined, wrappedTests: new WeakSet(), trackedContexts: new Set() };
    global[REGISTRY_KEY] = current;
  }
  return current;
}

/** Identity of a registration; the key builder function is "[function]" in the snapshot. */
function fingerprint(state: RegisteredState): string {
  return JSON.stringify([
    state.snapshot,
    state.mode,
    state.packageVersion,
    state.measuredProjects,
    state.runConditions,
  ]);
}

/**
 * Registers the state of this process. Registering the same config again changes nothing; a
 * different one replaces the previous one and gets the warning CONFIG_CHANGED_IN_PROCESS, which
 * is also returned (01-REQ-06).
 */
export function setRegistered(state: RegisteredState): Issue | undefined {
  const registry = slot();
  const previous = registry.state;
  if (previous !== undefined && fingerprint(previous) === fingerprint(state)) return undefined;
  registry.state = state;
  if (previous === undefined) return undefined;
  const warning: Issue = {
    code: 'CONFIG_CHANGED_IN_PROCESS',
    message:
      'config: withPerf() was called again in this process with a different package config; the last one is used',
    hint: 'Apply withPerf() once, to the Playwright config that is run, with one package config.',
  };
  state.warnings.push(warning);
  return warning;
}

export function getRegistered(): RegisteredState | undefined {
  return slot().state;
}

/** The warning of a reporter or fixture that finds the registry empty (01-REQ-07). */
export function notWrappedWarning(): Issue {
  return {
    code: 'NOT_WRAPPED_WITH_PERF',
    message:
      'config: withPerf() was not applied to the Playwright config in this process, so the default package config is used',
    hint: 'Wrap the Playwright config: export default withPerf(defineConfig({ ... }), perfConfig) with withPerf from "playwright-performance-regression/config".',
  };
}

export function wrappedTests(): WeakSet<object> {
  return slot().wrappedTests;
}

export function trackedContexts(): Set<object> {
  return slot().trackedContexts;
}
