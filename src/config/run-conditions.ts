// Run conditions of perf mode (01, chapter 4.4; 04-REQ-18, 04-REQ-32, 04-REQ-33; ADR-0006).
// Pure: a copy of the Playwright config is computed from the config object and the resolved run
// options; the input is never mutated (01-REQ-09).
import type { PlaywrightTestConfig, ReporterDescription } from '@playwright/test';
import type { ConfigIssue, Result } from '../core/types/index.ts';
import { PACKAGE_NAME } from '../core/types/index.ts';
import type { RunConditions } from '../registry/index.ts';

export interface PerfRunInput {
  /** run.projects of the resolved package config. */
  projects: 'auto' | string[];
  /** run.keepReporters of the resolved package config. */
  keepReporters: string[];
  /** Absolute path of the package reporter entry point. */
  reporterPath: string;
}

export interface PerfRunPlan<T> {
  config: T;
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

/** use.browserName of the project, else the global one, else defaultBrowserType, else chromium. */
function browserOf(project: Project | undefined, config: Config): string {
  return (
    project?.use?.browserName ??
    config.use?.browserName ??
    project?.use?.defaultBrowserType ??
    config.use?.defaultBrowserType ??
    'chromium'
  );
}

function quoted(names: readonly string[]): string {
  return names.map((name) => JSON.stringify(name)).join(', ');
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

/** Names of the measured projects (04-REQ-18) or the issues that prevent a run (03-REQ-11). */
function measuredNames(
  config: Config,
  projects: readonly Project[],
  option: PerfRunInput['projects'],
): Result<string[], ConfigIssue> {
  const names = projects.map(projectName);
  if (option !== 'auto') {
    const known = new Set(names);
    const unknown = option.filter((name) => !known.has(name));
    if (unknown.length > 0) {
      const available =
        names.length === 0 || config.projects === undefined
          ? 'it has no projects, only the default one'
          : `its projects are ${quoted(names)}`;
      return {
        ok: false,
        issues: unknown.map((name) => ({
          code: 'CONFIG_UNKNOWN_PROJECT',
          path: 'run.projects',
          message: `run.projects: project ${JSON.stringify(name)} is not in the Playwright config; ${available}`,
          hint: 'Use project names from the Playwright config, or "auto".',
        })),
      };
    }
    return { ok: true, value: names.filter((name) => option.includes(name)) };
  }
  const supporting = new Set(
    projects.flatMap((p) => [
      ...(p.dependencies ?? []),
      ...(p.teardown === undefined ? [] : [p.teardown]),
    ]),
  );
  const measured = projects
    .filter((p) => !supporting.has(projectName(p)) && browserOf(p, config) === 'chromium')
    .map(projectName);
  if (measured.length > 0) return { ok: true, value: measured };
  return {
    ok: false,
    issues: [
      {
        code: 'CONFIG_NO_MEASURED_PROJECT',
        path: 'run.projects',
        message:
          'run.projects: no project is measured; "auto" measures Chromium projects that are not a dependency or teardown of another project, and the Playwright config has none',
        hint: 'List the projects to measure in run.projects, e.g. ["firefox"].',
      },
    ],
  };
}

/** Measured projects with all their (also indirect) dependencies and teardowns. */
function projectsToKeep(projects: readonly Project[], measured: readonly string[]): Set<string> {
  const byName = new Map(projects.map((p) => [projectName(p), p]));
  const keep = new Set<string>();
  const visit = (name: string): void => {
    const project = byName.get(name);
    if (project === undefined || keep.has(name)) return;
    keep.add(name);
    for (const dependency of project.dependencies ?? []) visit(dependency);
    if (project.teardown !== undefined) visit(project.teardown);
  };
  for (const name of measured) visit(name);
  return keep;
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

/** Settings withPerf() changes; retries stay from the config (D-38). */
function overriddenSettings(config: Config, kept: readonly Project[]): string[] {
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
      hint: 'Remove slowMo from the Playwright config for the measurement run.',
    },
  ];
}

function enginesWarnings(
  config: Config,
  projects: readonly Project[],
  measured: readonly string[],
): ConfigIssue[] {
  const byName = new Map(projects.map((p) => [projectName(p), p]));
  const engines = [...new Set(measured.map((name) => browserOf(byName.get(name), config)))];
  if (engines.length < 2) return [];
  return [
    {
      code: 'CONFIG_MULTIPLE_ENGINES',
      path: 'run.projects',
      message: `run.projects: the measured projects use more than one browser engine (${engines.join(', ')}); their samples go to the same keys`,
      hint: 'Measure one browser engine per run: list projects of one engine in run.projects.',
    },
  ];
}

/**
 * The Playwright config of a perf mode run (01, chapter 4.4): measured projects, their
 * dependencies and teardowns, one worker, every test once per pass (repeatEach 1, D-39), retries
 * from the config (D-38), artifacts off, no run limits, filtered reporters plus the package
 * reporter.
 */
export function planPerfRun<T extends PlaywrightTestConfig>(
  config: T,
  input: PerfRunInput,
): Result<PerfRunPlan<T>, ConfigIssue> {
  const source: Config = config;
  const projects: readonly Project[] = source.projects ?? [{}];
  const measured = measuredNames(source, projects, input.projects);
  if (!measured.ok) return measured;

  const keep = projectsToKeep(projects, measured.value);
  const kept =
    source.projects === undefined ? [] : projects.filter((p) => keep.has(projectName(p)));
  const removedProjects =
    source.projects === undefined
      ? []
      : projects.filter((p) => !keep.has(projectName(p))).map(projectName);
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
  if (source.projects !== undefined) {
    result.projects = kept.map((p) => ({ ...p, repeatEach: 1, use: artifactsOff(p.use) }));
  }

  return {
    ok: true,
    value: {
      config: result as T,
      measuredProjects: measured.value,
      runConditions: {
        overridden: overriddenSettings(source, kept),
        removedProjects,
        removedReporters: removed,
        replacedReporters: replaced,
      },
      warnings: [
        ...enginesWarnings(source, projects, measured.value),
        ...slowMoWarnings(source, kept),
      ],
    },
  };
}
