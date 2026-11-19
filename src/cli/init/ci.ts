// CI job of the init wizard (04-REQ-38 step 8, 04-REQ-42): the recipes of examples/ci/ (embedded
// in generated/ci-templates.ts, 13-AC-11) with only the --grep and --env flags filled in. One file
// per environment label, so each environment has its own job. Pure.
import type { CiPlatform } from './detect.ts';
import { CI_TEMPLATES } from './generated/ci-templates.ts';

/** The command of every recipe that the flags are appended to. */
export const CI_COMMAND = 'npx pw-perf test';

interface CiTarget {
  /** File the job is written to, for the label (null: no environment). */
  path: (label: string | null) => string;
  /** Changes besides the flags that let jobs of several environments live side by side. */
  rename: (text: string, label: string) => string;
}

const suffix = (label: string | null): string => (label === null ? '' : `-${label}`);

export const CI_TARGETS: Readonly<Record<CiPlatform, CiTarget>> = {
  github: {
    path: (label) => `.github/workflows/perf${suffix(label)}.yml`,
    rename: (text, label) => text.replace(/^name: Performance$/mu, `name: Performance (${label})`),
  },
  gitlab: {
    path: (label) => `.gitlab/perf${suffix(label)}.gitlab-ci.yml`,
    rename: (text, label) => text.replace(/^perf:$/mu, `perf-${label}:`),
  },
  jenkins: { path: (label) => `Jenkinsfile.perf${suffix(label)}`, rename: (text) => text },
  azure: { path: (label) => `azure-pipelines.perf${suffix(label)}.yml`, rename: (text) => text },
};

/** Flags of the perf:test* script and the CI command (04-REQ-42). */
export function commandFlags(scope: 'all' | 'tagged', label: string | null): string {
  return `${scope === 'tagged' ? ' --grep @perf' : ''}${label === null ? '' : ` --env ${label}`}`;
}

/** The CI files for the platform and answers: path → content. */
export function ciFiles(
  platform: CiPlatform,
  scope: 'all' | 'tagged',
  envLabels: readonly string[],
): { path: string; text: string }[] {
  const target = CI_TARGETS[platform];
  const template: string = CI_TEMPLATES[platform];
  const labels: (string | null)[] = envLabels.length === 0 ? [null] : [...envLabels];
  return labels.map((label) => {
    let text = template.replace(CI_COMMAND, `${CI_COMMAND}${commandFlags(scope, label)}`);
    if (label !== null) text = target.rename(text, label);
    return { path: target.path(label), text };
  });
}
