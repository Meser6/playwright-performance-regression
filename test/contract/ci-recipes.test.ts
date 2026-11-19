// Syntax and structure checks of the CI recipes in examples/ci (13, chapter 8.3). The platforms'
// own validators need an account (GitLab CI lint, Azure Pipelines) or a server (the Jenkins
// declarative linter), so the YAML recipes are parsed strictly and checked against the keys each
// platform requires; the Jenkinsfile gets a lexical check. CI additionally runs actionlint on the
// GitHub Actions recipe.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';

const DIR = join(import.meta.dirname, '../../examples/ci');
const read = (name: string): string => readFileSync(join(DIR, name), 'utf8');
type Obj = Record<string, unknown>;

/** Strict YAML: duplicate keys, tabs and syntax errors throw. */
function yaml(name: string): Obj {
  const value: unknown = parse(read(name), { strict: true, uniqueKeys: true, prettyErrors: true });
  expect(value, name).toBeTypeOf('object');
  return value as Obj;
}

const obj = (value: unknown, what: string): Obj => {
  expect(value, what).toBeTypeOf('object');
  expect(Array.isArray(value), what).toBe(false);
  return value as Obj;
};
const list = (value: unknown, what: string): unknown[] => {
  expect(Array.isArray(value), what).toBe(true);
  return value as unknown[];
};
const onlyKeys = (value: Obj, allowed: string[], what: string): void => {
  expect(
    Object.keys(value).filter((key) => !allowed.includes(key)),
    what,
  ).toEqual([]);
};
/** Exactly one of `kinds` is set on a step. */
const oneOf = (step: Obj, kinds: string[], what: string): string => {
  const set = kinds.filter((kind) => step[kind] !== undefined);
  expect(set, what).toHaveLength(1);
  return set[0] ?? '';
};
const CRON = /^(\S+\s+){4}\S+$/u;

describe('13-AC-07 CI recipes in examples/ci', () => {
  test('there is one recipe per documented platform and docs/ci.md links each', () => {
    expect(readdirSync(DIR).sort()).toEqual([
      'Jenkinsfile',
      'azure-pipelines.yml',
      'github-actions.yml',
      'gitlab-ci.yml',
    ]);
    const docs = readFileSync(join(import.meta.dirname, '../../docs/ci.md'), 'utf8');
    for (const name of readdirSync(DIR)) expect(docs).toContain(`../examples/ci/${name}`);
  });

  test('GitHub Actions: workflow structure, report upload always', () => {
    const wf = yaml('github-actions.yml');
    onlyKeys(wf, ['name', 'on', 'jobs', 'permissions', 'env', 'concurrency'], 'workflow');
    const on = obj(wf.on, 'on');
    onlyKeys(on, ['pull_request', 'schedule', 'workflow_dispatch', 'push'], 'on');
    for (const entry of list(on.schedule, 'on.schedule')) {
      expect(obj(entry, 'schedule').cron).toMatch(CRON);
    }
    const jobs = obj(wf.jobs, 'jobs');
    for (const [id, value] of Object.entries(jobs)) {
      expect(id).toMatch(/^[A-Za-z_][\w-]*$/u);
      const job = obj(value, id);
      onlyKeys(job, ['runs-on', 'timeout-minutes', 'steps', 'env', 'if', 'name'], id);
      expect(job['runs-on'], 'runs-on').toBeTypeOf('string');
      expect(job['timeout-minutes'], 'timeout-minutes').toBeTypeOf('number');
      const steps = list(job.steps, 'steps').map((s, i) => obj(s, `step ${i}`));
      for (const [i, step] of steps.entries()) {
        onlyKeys(step, ['name', 'uses', 'run', 'with', 'if', 'env', 'id'], `step ${i}`);
        const kind = oneOf(step, ['uses', 'run'], `step ${i}`);
        if (kind === 'uses') expect(step.uses).toMatch(/^[\w.-]+\/[\w.-]+@\S+$/u);
      }
      expect(steps.some((s) => s.run === 'npx pw-perf test')).toBe(true);
      const upload = steps.find((s) => String(s.uses).startsWith('actions/upload-artifact@'));
      expect(upload?.if).toBe('always()');
      expect(obj(upload?.with, 'with').path).toBe('perf-results/');
    }
  });

  test('GitLab CI: job structure, exit code 2 as a soft failure, artifacts always', () => {
    const file = yaml('gitlab-ci.yml');
    const job = obj(file.perf, 'perf');
    onlyKeys(
      job,
      ['image', 'timeout', 'rules', 'script', 'allow_failure', 'artifacts', 'stage'],
      'perf',
    );
    expect(job.image).toBeTypeOf('string');
    expect(job.timeout).toMatch(/^\d+\s*(h|m|min|minutes|hours?)$/u);
    for (const rule of list(job.rules, 'rules')) expect(obj(rule, 'rule').if).toBeTypeOf('string');
    const script = list(job.script, 'script');
    expect(script.every((line) => typeof line === 'string')).toBe(true);
    expect(script).toContain('npx pw-perf test');
    expect(obj(job.allow_failure, 'allow_failure').exit_codes).toBe(2);
    const artifacts = obj(job.artifacts, 'artifacts');
    expect(artifacts.when).toBe('always');
    expect(artifacts.paths).toEqual(['perf-results/']);
  });

  test('Azure Pipelines: pipeline structure, code 2 succeeded with issues, publish always', () => {
    const file = yaml('azure-pipelines.yml');
    onlyKeys(file, ['trigger', 'pr', 'schedules', 'pool', 'jobs'], 'pipeline');
    for (const entry of list(file.schedules, 'schedules')) {
      expect(obj(entry, 'schedule').cron).toMatch(CRON);
    }
    expect(obj(file.pool, 'pool').vmImage).toBeTypeOf('string');
    for (const value of list(file.jobs, 'jobs')) {
      const job = obj(value, 'job');
      onlyKeys(job, ['job', 'timeoutInMinutes', 'steps', 'displayName', 'pool'], 'job');
      expect(job.job).toMatch(/^[A-Za-z_]\w*$/u);
      expect(job.timeoutInMinutes).toBeTypeOf('number');
      const steps = list(job.steps, 'steps').map((s, i) => obj(s, `step ${i}`));
      for (const [i, step] of steps.entries()) {
        const kind = oneOf(step, ['task', 'script', 'bash', 'publish'], `step ${i}`);
        onlyKeys(
          step,
          [kind, 'inputs', 'displayName', 'condition', 'artifact', 'env'],
          `step ${i}`,
        );
        if (kind === 'task') expect(step.task).toMatch(/^\w+@\d+$/u);
      }
      const run = steps.find((s) => String(s.bash).includes('npx pw-perf test'));
      expect(run?.bash).toContain('##vso[task.complete result=SucceededWithIssues;]');
      const publish = steps.find((s) => s.publish === 'perf-results');
      expect(publish?.condition).toBe('always()');
    }
  });

  test('Jenkins: balanced declarative pipeline, UNSTABLE on 2, archive always', () => {
    const text = read('Jenkinsfile');
    // Lexical check: strings and comments removed, then brackets must balance.
    const code = text
      .replace(/\/\/[^\n]*/gu, '')
      .replace(/"(?:[^"\\\n]|\\.)*"/gu, 'STR')
      .replace(/'(?:[^'\\\n]|\\.)*'/gu, 'STR');
    // No quote is left over: every string is closed on its line.
    expect(code).not.toMatch(/["']/u);
    const stack: string[] = [];
    const pairs: Record<string, string> = { ')': '(', '}': '{', ']': '[' };
    for (const char of code) {
      if ('({['.includes(char)) stack.push(char);
      else if (char in pairs) expect(stack.pop(), `unbalanced ${char}`).toBe(pairs[char]);
    }
    expect(stack).toEqual([]);
    expect(code).toMatch(/^pipeline \{/mu);
    for (const block of ['agent', 'options', 'triggers', 'stages', 'post']) {
      expect(code).toMatch(new RegExp(`^ {2}${block}\\b`, 'mu'));
    }
    expect(text).toContain("sh(script: 'npx pw-perf test', returnStatus: true)");
    expect(text).toMatch(/if \(code == 2\) \{\s+unstable\(/u);
    expect(text).toMatch(/always \{\s+archiveArtifacts artifacts: 'perf-results\/\*\*'/u);
  });
});
