// Run conditions of perf mode (01, chapter 4.4; 04-REQ-18, 04-REQ-32, 04-REQ-33, 03-REQ-27;
// ADR-0006).
// Pure: a copy of the Playwright config is computed from the config object and the resolved run
// options; the input is never mutated (01-REQ-09).
import type { PlaywrightTestConfig, ReporterDescription } from '@playwright/test';
import type { ConfigIssue, Result } from '../core/types/index.ts';
import { PACKAGE_NAME } from '../core/types/index.ts';
import type { RunConditions } from '../registry/index.ts';

export interface PerfRunInput {
  /** run.keepReporters of the resolved package config. */
  keepReporters: string[];
  /** Absolute path of the package reporter entry point. */
  reporterPath: string;
  /** run.grep of the resolved package config (03-REQ-25); null or absent: all tests. */
  grep?: string | null;
  /** run.overrideSlowMo (03-REQ-27, D-45): slowMo 0 in every measured project. */
  overrideSlowMo?: boolean;
}

export interface PerfRunPlan<T> {
  config: T;
  /**
   * Projects that may be measured (04-REQ-18, D-44): all but setup and teardown projects. The test
   * command selects which of them run (--project); the reporter measures those in the run.
   */
  measuredProjects: string[];
  runConditions: RunConditions;
  warnings: ConfigIssue[];
}

type Config = PlaywrightTestConfig;
type Project = NonNullable<Config['projects']>[number];
type Use = NonNullable<Config['use']>;

const CONSOLE_REPORTERS = new Set(['list', 'line', 'dot', 'github']);
const ARTIFACTS = ['trace', 'video', 'screenshot'] as const;
const PACKAGE_REPORTER = `${PACKAGE_NAME}/reporter`;

function projectName(project: Project): string {
  return project.name ?? '';
}

/** An artifact setting that records something: anything but 'off' or { mode: 'off' }. */
function records(value: unknown): boolean {
  if (value === undefined || value === 'off') return false;
  if (typeof value === 'object' && value !== null && 'mode' in value) return value.mode !== 'off';
  return true;
}

function positive(value: number | undefined): boolean {
  return value !== undefined && value > 0;
}

function artifactsOff(use: Use | undefined): Use {
  return { ...use, trace: 'off', video: 'off', screenshot: 'off' };
}

type Grep = NonNullable<Config['grep']>;

/**
 * The grep of a measured project with run.grep (03-REQ-25): `extra` alone, or, when the project
 * has its own grep, one expression that needs both (lookaheads), case-insensitive.
 */
export function andGrep(extra: string, own: Grep | undefined): RegExp {
  if (own === undefined) return new RegExp(extra, 'i');
  const list = Array.isArray(own) ? own : [own];
  const flags = new Set(['i', ...list.flatMap((re) => [...re.flags])]);
  flags.delete('g');
  flags.delete('y');
  const ownSource = list.map((re) => `(?:${re.source})`).join('|');
  return new RegExp(
    `^(?=[\\s\\S]*?(?:${extra}))(?=[\\s\\S]*?(?:${ownSource}))`,
    [...flags].sort().join(''),
  );
}

/**
 * Projects that may be measured (04-REQ-18, D-44): every project whose name is not in the
 * dependencies or the teardown of another project. Setup and teardown projects run once per pass
 * and collect nothing (05-REQ-21).
 */
export function measurableProjects(projects: readonly Project[]): string[] {
  const supporting = new Set(
    projects.flatMap((p) => [
      ...(p.dependencies ?? []),
      ...(p.teardown === undefined ? [] : [p.teardown]),
    ]),
  );
  return projects.map(projectName).filter((name) => !supporting.has(name));
}

type Entry = [string, unknown?];

/** The reporter option as a list of [name, options] (a string is one reporter). */
function reporterEntries(reporter: Config['reporter']): Entry[] {
  if (reporter === undefined) return [];
  if (typeof reporter === 'string') return [[reporter]];
  return (reporter as readonly (string | readonly unknown[])[]).map((item): Entry =>
    typeof item === 'string'
      ? [item]
      : item.length > 1
        ? [String(item[0]), item[1]]
        : [String(item[0])],
  );
}

function planReporters(
  reporter: Config['reporter'],
  input: PerfRunInput,
): { reporters: Entry[]; removed: string[]; replaced: string[] } {
  const ours = (name: string): boolean => name === input.reporterPath || name === PACKAGE_REPORTER;
  const kept: Entry[] = [];
  const removed: string[] = [];
  const replaced: string[] = [];
  for (const entry of reporterEntries(reporter)) {
    const [name, options] = entry;
    if (name === 'list' && !input.keepReporters.includes(name)) {
      // A measurement run has hundreds of executions: one line each floods the terminal
      // (04-REQ-32, 04-D-24). Options of list do not apply to dot.
      if (!replaced.includes(name)) replaced.push(name);
      kept.push(['dot']);
    } else if (!CONSOLE_REPORTERS.has(name) && !input.keepReporters.includes(name) && !ours(name)) {
      removed.push(name);
    } else if (name === 'html') {
      kept.push([name, { ...(options as object | undefined), open: 'never' }]);
    } else {
      kept.push(entry);
    }
  }
  // One dot is enough, also when list became dot next to an existing dot.
  const firstDot = kept.findIndex(([name]) => name === 'dot');
  const deduped = kept.filter(([name], i) => name !== 'dot' || i === firstDot);
  const reporters: Entry[] = [];
  if (!deduped.some(([name]) => CONSOLE_REPORTERS.has(name))) reporters.push(['dot']);
  reporters.push(...deduped);
  if (!deduped.some(([name]) => ours(name))) reporters.push([input.reporterPath]);
  return { reporters, removed, replaced };
}

type LaunchOptions = NonNullable<Use['launchOptions']>;

/**
 * The launch options a project runs with: Playwright merges the project use into the config use
 * shallowly, so the project's own launchOptions replace the global ones as a whole.
 */
function effectiveLaunchOptions(config: Config, project?: Project): LaunchOptions | undefined {
  return project?.use?.launchOptions ?? config.use?.launchOptions;
}

/**
 * Measured scopes and their launch options: each measured project or, without a projects list,
 * the global use (one default project).
 */
function measuredLaunchOptions(
  config: Config,
  measured: ReadonlySet<string>,
): (LaunchOptions | undefined)[] {
  if (config.projects === undefined) return [config.use?.launchOptions];
  return config.projects
    .filter((p) => measured.has(projectName(p)))
    .map((p) => effectiveLaunchOptions(config, p));
}

/** Settings withPerf() changes; retries stay from the config (D-38). */
function overriddenSettings(
  config: Config,
  kept: readonly Project[],
  slowMoOverridden: boolean,
): string[] {
  const scopes: { use?: Use }[] = [config, ...kept];
  const repeatChanged = [config, ...kept].some(
    (scope) => scope.repeatEach !== undefined && scope.repeatEach !== 1,
  );
  const changed: [string, boolean][] = [
    ['workers', config.workers !== 1],
    ['repeatEach', repeatChanged],
    ['maxFailures', positive(config.maxFailures)],
    ['globalTimeout', positive(config.globalTimeout)],
    ...ARTIFACTS.map((name): [string, boolean] => [
      name,
      scopes.some((scope) => records(scope.use?.[name])),
    ]),
    ['slowMo', slowMoOverridden],
  ];
  return changed.filter(([, value]) => value).map(([name]) => name);
}

function slowMoWarnings(config: Config, kept: readonly Project[]): ConfigIssue[] {
  const places = [
    ...(positive(config.use?.launchOptions?.slowMo) ? ['the global config'] : []),
    ...kept
      .filter((p) => positive(p.use?.launchOptions?.slowMo))
      .map((p) => `project ${JSON.stringify(projectName(p))}`),
  ];
  if (places.length === 0) return [];
  return [
    {
      code: 'CONFIG_SLOW_MO',
      path: 'use.launchOptions.slowMo',
      message: `use.launchOptions.slowMo: is greater than 0 in ${places.join(', ')}; it slows down every browser action and distorts the measured times`,
      hint: 'Remove slowMo from the Playwright config for the measurement run, or set run.overrideSlowMo: true in the package config.',
    },
  ];
}

/**
 * The Playwright config of a perf mode run (01, chapter 4.4): every project (the test command
 * selects them, 04-REQ-18), one worker, every test once per pass (repeatEach 1, D-39), retries
 * from the config (D-38), artifacts off, no run limits, filtered reporters plus the package
 * reporter; with run.overrideSlowMo, slowMo 0 in every measured project (03-REQ-27).
 */
export function planPerfRun<T extends PlaywrightTestConfig>(
  config: T,
  input: PerfRunInput,
): Result<PerfRunPlan<T>, ConfigIssue> {
  const source: Config = config;
  const projects: readonly Project[] = source.projects ?? [{}];
  const measured = measurableProjects(projects);
  const { reporters, removed, replaced } = planReporters(source.reporter, input);

  const result: Config = {
    ...source,
    workers: 1,
    maxFailures: 0,
    globalTimeout: 0,
    use: artifactsOff(source.use),
    reporter: reporters as unknown as ReporterDescription[],
  };
  result.repeatEach = 1;
  const grep = input.grep ?? null;
  const overrideSlowMo = input.overrideSlowMo ?? false;
  const kept = source.projects ?? [];
  const measuredSet = new Set(measured);
  if (source.projects !== undefined) {
    result.projects = kept.map((p) => {
      const project: Project = { ...p, repeatEach: 1, use: artifactsOff(p.use) };
      const isMeasured = measuredSet.has(projectName(p));
      // run.grep only for measured projects; setup and teardown projects run in full.
      if (grep !== null && isMeasured) {
        project.grep = andGrep(grep, p.grep ?? source.grep);
      }
      if (overrideSlowMo && isMeasured) {
        project.use = {
          ...project.use,
          launchOptions: { ...effectiveLaunchOptions(source, p), slowMo: 0 },
        };
      }
      return project;
    });
  } else {
    if (grep !== null) result.grep = andGrep(grep, source.grep);
    if (overrideSlowMo) {
      result.use = { ...result.use, launchOptions: { ...source.use?.launchOptions, slowMo: 0 } };
    }
  }
  const slowMoOverridden =
    overrideSlowMo &&
    measuredLaunchOptions(source, measuredSet).some((options) => positive(options?.slowMo));

  return {
    ok: true,
    value: {
      config: result as T,
      measuredProjects: measured,
      runConditions: {
        overridden: overriddenSettings(source, kept, slowMoOverridden),
        removedReporters: removed,
        replacedReporters: replaced,
      },
      warnings: overrideSlowMo ? [] : slowMoWarnings(source, kept),
    },
  };
}
