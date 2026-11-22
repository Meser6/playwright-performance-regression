// CI jobs of the init wizard (04-REQ-38 step 7, 04-REQ-69): the recipes of examples/ci/ (embedded
// in generated/ci-templates.ts, 13-AC-11) with only the test command replaced by the project's
// command C (the answer of step 6, 04-REQ-55), quoted where the file format needs it. Every
// recipe has a manual thresholds job and a weekly measurement job that set PW_PERF_MODE
// (13-REQ-16). Pure.
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

/** A YAML block-sequence item: plain when safe, else single-quoted ('' for '). */
export function yamlScalar(text: string): string {
  const plain = !/^[-?:,[\]{}#&*!|>'"%@`\s]/u.test(text) && !/(: |\s#|:$|\s$|['"\t])/u.test(text);
  return plain ? text : `'${text.replaceAll("'", "''")}'`;
}

/** The content of a single-quoted Groovy string. */
export function groovySingleQuoted(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

/** The CI file for the platform with the test command `command` (C of 04-REQ-55). */
export function ciFile(platform: CiPlatform, command: string): { path: string; text: string } {
  const template: string = CI_TEMPLATES[platform];
  const text =
    platform === 'gitlab'
      ? // A sequence item of a plain YAML list.
        template.replaceAll(`- ${CI_COMMAND} || true`, `- ${yamlScalar(`${command} || true`)}`)
      : platform === 'jenkins'
        ? template.replaceAll(`'${CI_COMMAND}'`, `'${groovySingleQuoted(command)}'`)
        : // GitHub Actions and Azure Pipelines: inside a `|` block, taken literally.
          template.replaceAll(CI_COMMAND, command);
  return { path: CI_PATHS[platform], text };
}
