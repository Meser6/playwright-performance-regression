// Default answers of the init wizard (04-REQ-38): what a run without a terminal uses.
// Origin labels and environments are not asked (07-REQ-03, note #26). Pure.
import { DEFAULT_CONFIG } from '../../core/config/index.ts';
import type { ProjectInfo } from './detect.ts';
import type { InitAnswers } from './perf-config.ts';
import { defaultProjects } from './projects.ts';
import { defaultScript } from './scripts.ts';

/** Default of the passes step: the default of run.passes.test. */
export const DEFAULT_ANSWERS_PASSES: number = DEFAULT_CONFIG.run.passes.test;

/** Step 3 is asked only with at least 2 non-helper literal projects (04-REQ-57). */
export function asksProjects(info: ProjectInfo): boolean {
  return (info.projects ?? []).filter((p) => !p.helper).length >= 2;
}

export function defaultAnswers(info: ProjectInfo): InitAnswers {
  const script = defaultScript(info.testScripts);
  const detected = info.testScripts.find((s) => s.name === script) ?? null;
  return {
    script,
    projects:
      info.projects !== null && asksProjects(info)
        ? defaultProjects(info.projects, detected)
        : 'auto',
    // All tests, also when some tests are tagged @perf.
    scope: 'all',
    passesTest: DEFAULT_ANSWERS_PASSES,
    // Steps are measured by default, also without test.step calls (04-REQ-47).
    steps: DEFAULT_CONFIG.measure.steps,
    preset: DEFAULT_CONFIG.thresholds.preset,
    addCi: info.ciPlatform !== null,
    // Never without a terminal (04-REQ-58).
    runCheck: false,
  };
}
