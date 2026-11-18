// Machine and CI metadata of the run, read from the environment (02-REQ-28). Core gets the
// finished objects (01-REQ-02).
import { availableParallelism, cpus } from 'node:os';
import type { CiInfo, RunReport } from '../core/types/index.ts';

type Env = Readonly<Record<string, string | undefined>>;

/** Value of a variable, or null when it is not set or empty. */
function read(env: Env, name: string): string | null {
  const value = env[name];
  return value === undefined || value === '' ? null : value;
}

function first(env: Env, ...names: string[]): string | null {
  for (const name of names) {
    const value = read(env, name);
    if (value !== null) return value;
  }
  return null;
}

/** Joins the parts when every variable is set, otherwise null. */
function compose(env: Env, build: (values: string[]) => string, ...names: string[]): string | null {
  const values = names.map((name) => read(env, name));
  return values.every((v) => v !== null) ? build(values as string[]) : null;
}

/** `ci` of the run report: first matching provider row of 02-REQ-28, or null outside CI. */
export function readCiInfo(env: Env): CiInfo | null {
  if (env.GITHUB_ACTIONS === 'true') {
    return {
      provider: 'github',
      commit: read(env, 'GITHUB_SHA'),
      branch: first(env, 'GITHUB_HEAD_REF', 'GITHUB_REF_NAME'),
      buildUrl: compose(
        env,
        ([server, repository, runId]) => `${server}/${repository}/actions/runs/${runId}`,
        'GITHUB_SERVER_URL',
        'GITHUB_REPOSITORY',
        'GITHUB_RUN_ID',
      ),
    };
  }
  if (env.GITLAB_CI === 'true') {
    return {
      provider: 'gitlab',
      commit: read(env, 'CI_COMMIT_SHA'),
      branch: read(env, 'CI_COMMIT_REF_NAME'),
      buildUrl: read(env, 'CI_JOB_URL'),
    };
  }
  if (read(env, 'JENKINS_URL') !== null) {
    return {
      provider: 'jenkins',
      commit: read(env, 'GIT_COMMIT'),
      branch: first(env, 'BRANCH_NAME', 'GIT_BRANCH'),
      buildUrl: read(env, 'BUILD_URL'),
    };
  }
  if (env.TF_BUILD === 'True') {
    return {
      provider: 'azure',
      commit: read(env, 'BUILD_SOURCEVERSION'),
      branch: read(env, 'BUILD_SOURCEBRANCHNAME'),
      buildUrl: compose(
        env,
        ([collection, project, buildId]) =>
          `${collection}${project}/_build/results?buildId=${buildId}`,
        'SYSTEM_COLLECTIONURI',
        'SYSTEM_TEAMPROJECT',
        'BUILD_BUILDID',
      ),
    };
  }
  if (read(env, 'CI') !== null)
    return { provider: 'other', commit: null, branch: null, buildUrl: null };
  return null;
}

/** `host` of the run report (02-REQ-28). */
export function readHostInfo(env: Env): RunReport['host'] {
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    ci: read(env, 'CI') !== null,
    cpuCount: availableParallelism(),
    cpuModel: cpus()[0]?.model.trim() ?? '',
  };
}
