// Default answers of the init wizard (04-REQ-38): what a run without a terminal uses.
// Origin labels and environments are not asked (07-REQ-03, note #26). Pure.
import { DEFAULT_CONFIG } from '../../core/config/index.ts';
import type { ProjectInfo } from './detect.ts';
import type { InitAnswers } from './perf-config.ts';

/** Default of the passes step: the default of run.passes.test. */
export const DEFAULT_ANSWERS_PASSES: number = DEFAULT_CONFIG.run.passes.test;

export function defaultAnswers(info: ProjectInfo): InitAnswers {
  return {
    // All tests, also when some tests are tagged @perf.
    scope: 'all',
    passesTest: DEFAULT_ANSWERS_PASSES,
    // Endpoints and steps, also without test.step calls (04-REQ-47).
    measure: 'all',
    preset: DEFAULT_CONFIG.thresholds.preset,
    addCi: info.ciPlatform !== null,
    // Never without a terminal (04-REQ-58).
    runCheck: false,
  };
}
