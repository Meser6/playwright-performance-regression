import { describe, expect, test } from 'vitest';
import { readCiInfo, readHostInfo } from '../../../src/io/run-metadata.ts';

describe('CI metadata (02-REQ-28)', () => {
  test('02-AC-10 github', () => {
    const env = {
      CI: 'true',
      GITHUB_ACTIONS: 'true',
      GITHUB_SHA: 'abc',
      GITHUB_HEAD_REF: 'feature',
      GITHUB_REF_NAME: '12/merge',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_RUN_ID: '42',
    };
    expect(readCiInfo(env)).toEqual({
      provider: 'github',
      commit: 'abc',
      branch: 'feature',
      buildUrl: 'https://github.com/o/r/actions/runs/42',
    });
    expect(readCiInfo({ ...env, GITHUB_HEAD_REF: '' })?.branch).toBe('12/merge');
    expect(readCiInfo({ ...env, GITHUB_RUN_ID: undefined })?.buildUrl).toBe(null);
  });

  test('02-AC-10 gitlab', () => {
    expect(
      readCiInfo({
        GITLAB_CI: 'true',
        CI_COMMIT_SHA: 'abc',
        CI_COMMIT_REF_NAME: 'main',
        CI_JOB_URL: 'https://gitlab.com/o/r/-/jobs/1',
      }),
    ).toEqual({
      provider: 'gitlab',
      commit: 'abc',
      branch: 'main',
      buildUrl: 'https://gitlab.com/o/r/-/jobs/1',
    });
  });

  test('02-AC-10 jenkins', () => {
    const env = {
      JENKINS_URL: 'https://ci.example/',
      GIT_COMMIT: 'abc',
      BRANCH_NAME: 'PR-1',
      GIT_BRANCH: 'origin/main',
      BUILD_URL: 'https://ci.example/job/x/1/',
    };
    expect(readCiInfo(env)).toEqual({
      provider: 'jenkins',
      commit: 'abc',
      branch: 'PR-1',
      buildUrl: 'https://ci.example/job/x/1/',
    });
    expect(readCiInfo({ ...env, BRANCH_NAME: '' })?.branch).toBe('origin/main');
  });

  test('02-AC-10 azure', () => {
    const env = {
      TF_BUILD: 'True',
      BUILD_SOURCEVERSION: 'abc',
      BUILD_SOURCEBRANCHNAME: 'main',
      SYSTEM_COLLECTIONURI: 'https://dev.azure.com/org/',
      SYSTEM_TEAMPROJECT: 'proj',
      BUILD_BUILDID: '7',
    };
    expect(readCiInfo(env)).toEqual({
      provider: 'azure',
      commit: 'abc',
      branch: 'main',
      buildUrl: 'https://dev.azure.com/org/proj/_build/results?buildId=7',
    });
    expect(readCiInfo({ ...env, SYSTEM_TEAMPROJECT: undefined })?.buildUrl).toBe(null);
  });

  test('02-AC-10 other CI and missing variables give null fields', () => {
    expect(readCiInfo({ CI: 'true' })).toEqual({
      provider: 'other',
      commit: null,
      branch: null,
      buildUrl: null,
    });
    expect(readCiInfo({ GITHUB_ACTIONS: 'true' })).toEqual({
      provider: 'github',
      commit: null,
      branch: null,
      buildUrl: null,
    });
  });

  test('02-AC-10 the first matching row wins', () => {
    expect(readCiInfo({ CI: 'true', GITLAB_CI: 'true', JENKINS_URL: 'x' })?.provider).toBe(
      'gitlab',
    );
  });

  test('02-AC-10 outside CI ci is null', () => {
    expect(readCiInfo({})).toBe(null);
    expect(readCiInfo({ GITHUB_ACTIONS: 'false', TF_BUILD: 'true', CI: '' })).toBe(null);
  });
});

describe('host metadata (02-REQ-28)', () => {
  test('reads platform, Node, CPU count and trimmed CPU model', () => {
    const host = readHostInfo({ CI: 'true' });
    expect(host).toEqual({
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      ci: true,
      cpuCount: expect.any(Number),
      cpuModel: expect.any(String),
    });
    expect(host.cpuCount).toBeGreaterThanOrEqual(1);
    expect(host.cpuModel).toBe(host.cpuModel.trim());
    expect(readHostInfo({}).ci).toBe(false);
  });
});
