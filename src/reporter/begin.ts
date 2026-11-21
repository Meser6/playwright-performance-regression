// What the reporter derives from FullConfig in onBegin (01, chapter 4.6): the run conditions of
// the report, deviations from the conditions withPerf() set (04-REQ-19), duplicate origin labels
// of baseURL (03-REQ-11) and the info lines of 01-REQ-37 and 04-REQ-20.
import type { ResolvedConfig } from '../core/config/index.ts';
import { canonicalOrigin, measuredBaseOrigins } from '../core/normalize/index.ts';
import type { Issue, RunReport } from '../core/types/index.ts';
import type { RunConditions } from '../registry/index.ts';
import type { ConfigLike, ProjectLike, TestLike } from './types.ts';

export type RunConditionsReport = RunReport['runConditions'];
type Role = RunConditionsReport['projects'][number]['role'];

/** Effective browser of a project, as withPerf() decides it (04-REQ-18); `use` is merged. */
export function browserOf(project: ProjectLike): string {
  return project.use.browserName ?? project.use.defaultBrowserType ?? 'chromium';
}

function roleOf(
  project: ProjectLike,
  all: readonly ProjectLike[],
  measured: ReadonlySet<string>,
): Role {
  if (measured.has(project.name)) return 'measured';
  return all.some((p) => p.teardown === project.name) ? 'teardown' : 'dependency';
}

/** runConditions of the report: effective values read from FullConfig (ADR-0006). */
export function readRunConditions(
  config: ConfigLike,
  measured: ReadonlySet<string>,
  overridden: readonly string[],
): RunConditionsReport {
  return {
    workers: config.workers,
    projects: config.projects.map((project) => ({
      name: project.name,
      role: roleOf(project, config.projects, measured),
      browserName: browserOf(project),
      repeatEach: project.repeatEach,
      retries: project.retries,
    })),
    overriddenSettings: [...overridden],
  };
}

/**
 * RUN_CONDITIONS_CHANGED when the effective workers or repeatEach differ from what withPerf()
 * set, e.g. after a Playwright command line flag (04-REQ-19). Retries come from the config and
 * are no deviation (D-38).
 */
export function runConditionsWarning(conditions: RunConditionsReport): Issue | null {
  const diffs: string[] = [];
  if (conditions.workers !== 1) diffs.push(`workers ${conditions.workers} (expected 1)`);
  for (const project of conditions.projects) {
    if (project.repeatEach !== 1) {
      const name = `project ${JSON.stringify(project.name)}`;
      diffs.push(`${name} repeatEach ${project.repeatEach} (expected 1)`);
    }
  }
  if (diffs.length === 0) return null;
  return {
    code: 'RUN_CONDITIONS_CHANGED',
    message: `The run conditions differ from those set for perf mode: ${diffs.join('; ')}.`,
    hint: 'Do not pass --workers or --repeat-each to a perf-mode run; set the number of passes with run.passes or PW_PERF_PASSES.',
  };
}

/**
 * CONFIG_DUPLICATE_ORIGIN_LABEL for origins that share the empty label: the baseURL origins of
 * the measured projects not labelled in keys.origins, and keys.origins entries labelled "" (07-REQ-20,
 * 03-REQ-11). Duplicates within keys.origins alone are reported by resolveConfig.
 */
export function duplicateBaseUrlLabels(
  conditions: RunConditionsReport,
  config: ConfigLike,
  keys: ResolvedConfig['keys'],
): Issue | null {
  const baseOrigins = measuredBaseOrigins(
    conditions.projects.map((p, i) => ({ role: p.role, baseURL: config.projects[i]?.use.baseURL })),
  );
  const labelled = new Map<string, string>();
  for (const [origin, label] of Object.entries(keys.origins)) {
    const canonical = canonicalOrigin(origin);
    if (canonical !== null) labelled.set(canonical, label);
  }
  const unlabelled = baseOrigins.filter((origin) => !labelled.has(origin));
  if (unlabelled.length === 0) return null;
  const empty = [
    ...unlabelled,
    ...[...labelled].filter(([, label]) => label === '').map(([origin]) => origin),
  ].sort();
  if (empty.length < 2) return null;
  return {
    code: 'CONFIG_DUPLICATE_ORIGIN_LABEL',
    message: `${empty.map((o) => JSON.stringify(o)).join(', ')} share the empty label (use.baseURL of measured projects), so their endpoint keys are merged`,
    hint: 'Give each origin its own label in keys.origins unless merging their keys is intended.',
  };
}

function list(names: readonly string[]): string {
  return names.map((n) => (n === '' ? '(default)' : n)).join(', ');
}

/** The info line of 01-REQ-37, or null when withPerf() changed nothing. */
export function overriddenLine(conditions: RunConditions): string | null {
  const parts: string[] = [];
  if (conditions.overridden.length > 0) {
    parts.push(`perf mode overrides ${conditions.overridden.join(', ')}`);
  }
  if (conditions.removedProjects.length > 0) {
    parts.push(`removed projects ${list(conditions.removedProjects)}`);
  }
  if (conditions.removedReporters.length > 0) {
    parts.push(`removed reporters ${list(conditions.removedReporters)}`);
  }
  for (const name of conditions.replacedReporters) {
    parts.push(`reporter ${name} replaced with dot`);
  }
  return parts.length === 0 ? null : `${parts.join('; ')}.`;
}

/** Tests of measured projects selected for the run (04-REQ-65): suite.allTests() of one pass. */
export function measuredTestCount(
  tests: readonly TestLike[],
  measured: ReadonlySet<string>,
): number {
  return tests.filter((t) => measured.has(t.parent.project()?.name ?? '')).length;
}
