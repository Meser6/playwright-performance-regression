// CI jobs of the init wizard (04-REQ-38 step 8, 04-REQ-69): the recipes of examples/ci/ (embedded
// in generated/ci-templates.ts, 13-AC-11) with only the test command replaced by the project's
// command C (04-REQ-55). Every recipe has a manual thresholds job and a weekly measurement job
// that set PW_PERF_MODE (13-REQ-16). Pure.
import type { CiPlatform } from './detect.ts';
import { CI_TEMPLATES } from './generated/ci-templates.ts';

/** The test command of every recipe, replaced by the project's command. */
export const CI_COMMAND = 'npm run e2e';

/** File the jobs of each platform are written to. */
export const CI_PATHS: Readonly<Record<CiPlatform, string>> = {
  github: '.github/workflows/perf.yml',
  gitlab: '.gitlab/perf.gitlab-ci.yml',
  jenkins: 'Jenkinsfile.perf',
  azure: 'azure-pipelines.perf.yml',
};

/** The CI file for the platform with the test command `command` (C of 04-REQ-55). */
export function ciFile(platform: CiPlatform, command: string): { path: string; text: string } {
  const template: string = CI_TEMPLATES[platform];
  return { path: CI_PATHS[platform], text: template.replaceAll(CI_COMMAND, command) };
}
