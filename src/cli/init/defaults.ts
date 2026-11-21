// Default answers of the init wizard (04-REQ-38): what --yes and a run without a terminal use.
// Origin labels are not asked: they follow the baseURL automatically (07-REQ-03). Pure.
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
    warnOnly: true,
    // Yes when the project has test.step calls (04-REQ-47).
    steps: info.stepFiles > 0,
    envLabels: [],
    addCi: info.ciPlatform !== null,
  };
}
