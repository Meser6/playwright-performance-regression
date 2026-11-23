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

  /** The run step of every job: outcome.json removed, the project command, exit code from it. */
  const RUN =
    /rm -f reports\/pw-perf\/outcome\.json\n.*npm run e2e \|\| true\n.*outcome\.json'\)\.exitCode/su;

  test('04-AC-49 GitHub Actions: manual thresholds job, weekly measure job, uploads always', () => {
    const wf = yaml('github-actions.yml');
    onlyKeys(wf, ['name', 'on', 'jobs', 'permissions', 'env', 'concurrency'], 'workflow');
    const on = obj(wf.on, 'on');
    onlyKeys(on, ['schedule', 'workflow_dispatch'], 'on');
    for (const entry of list(on.schedule, 'on.schedule')) {
      expect(obj(entry, 'schedule').cron).toMatch(CRON);
    }
    const inputs = obj(obj(on.workflow_dispatch, 'workflow_dispatch').inputs, 'inputs');
    expect(obj(inputs.mode, 'mode').options).toEqual(['test', 'thresholds']);
    const jobs = obj(wf.jobs, 'jobs');
    expect(Object.keys(jobs)).toEqual(['thresholds', 'measure']);
    for (const [id, value] of Object.entries(jobs)) {
      const job = obj(value, id);
      onlyKeys(job, ['runs-on', 'timeout-minutes', 'steps', 'env', 'if', 'name'], id);
      expect(job['runs-on'], 'runs-on').toBeTypeOf('string');
      expect(job['timeout-minutes'], 'timeout-minutes').toBeTypeOf('number');
      expect(obj(job.env, 'env').PW_PERF_MODE).toBe(id === 'measure' ? 'test' : 'thresholds');
      const steps = list(job.steps, 'steps').map((s, i) => obj(s, `step ${i}`));
      for (const [i, step] of steps.entries()) {
        onlyKeys(step, ['name', 'uses', 'run', 'with', 'if', 'env', 'id'], `step ${i}`);
        const kind = oneOf(step, ['uses', 'run'], `step ${i}`);
        if (kind === 'uses') expect(step.uses).toMatch(/^[\w.-]+\/[\w.-]+@\S+$/u);
      }
      expect(steps.some((s) => RUN.test(String(s.run)))).toBe(true);
      const upload = steps.find((s) => String(s.uses).startsWith('actions/upload-artifact@'));
      expect(upload?.if).toBe('always()');
      const path = String(obj(upload?.with, 'with').path);
      expect(path).toContain('reports/pw-perf/');
      if (id === 'thresholds') expect(path).toContain('pw-perf-thresholds*.json');
    }
  });

  test('04-AC-49 GitLab CI: manual thresholds job, scheduled perf job, code 2 soft, artifacts always', () => {
    const file = yaml('gitlab-ci.yml');
    onlyKeys(file, ['.perf', 'perf-thresholds', 'perf'], 'file');
    const base = obj(file['.perf'], '.perf');
    expect(base.image).toBeTypeOf('string');
    const script = list(base.script, 'script');
    expect(script.every((line) => typeof line === 'string')).toBe(true);
    expect(RUN.test(script.join('\n'))).toBe(true);
    for (const [id, mode] of [
      ['perf-thresholds', 'thresholds'],
      ['perf', 'test'],
    ] as const) {
      const job = obj(file[id], id);
      onlyKeys(
        job,
        ['extends', 'timeout', 'variables', 'rules', 'allow_failure', 'artifacts', 'stage'],
        id,
      );
      expect(job.extends).toBe('.perf');
      expect(job.timeout).toMatch(/^\d+\s*(h|m|min|minutes|hours?)$/u);
      expect(obj(job.variables, 'variables').PW_PERF_MODE).toBe(mode);
      const artifacts = obj(job.artifacts, 'artifacts');
      expect(artifacts.when).toBe('always');
      expect(artifacts.paths).toContain('reports/pw-perf/');
    }
    const thresholds = obj(file['perf-thresholds'], 'perf-thresholds');
    expect(list(thresholds.rules, 'rules')).toEqual([{ when: 'manual' }]);
    expect(obj(thresholds.artifacts, 'artifacts').paths).toContain('pw-perf-thresholds*.json');
    const perf = obj(file.perf, 'perf');
    expect(obj(list(perf.rules, 'rules')[0], 'rule').if).toBe('$CI_PIPELINE_SOURCE == "schedule"');
    expect(obj(perf.allow_failure, 'allow_failure').exit_codes).toBe(2);
  });

  test('04-AC-49 Azure Pipelines: mode parameter, weekly schedule, code 2 succeeded with issues', () => {
    const file = yaml('azure-pipelines.yml');
    onlyKeys(file, ['trigger', 'pr', 'parameters', 'schedules', 'pool', 'jobs'], 'pipeline');
    expect(obj(list(file.parameters, 'parameters')[0], 'parameter').values).toEqual([
      'test',
      'thresholds',
    ]);
    for (const entry of list(file.schedules, 'schedules')) {
      expect(obj(entry, 'schedule').cron).toMatch(CRON);
    }
    expect(obj(file.pool, 'pool').vmImage).toBeTypeOf('string');
    for (const value of list(file.jobs, 'jobs')) {
      const job = obj(value, 'job');
      onlyKeys(
        job,
        ['job', 'timeoutInMinutes', 'steps', 'displayName', 'pool', 'variables'],
        'job',
      );
      expect(job.job).toMatch(/^[A-Za-z_]\w*$/u);
      expect(job.timeoutInMinutes).toBeTypeOf('number');
      expect(obj(job.variables, 'variables').PW_PERF_MODE).toBe('${{ parameters.mode }}');
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
      const run = steps.find((s) => RUN.test(String(s.bash)));
      expect(run?.bash).toContain('##vso[task.complete result=SucceededWithIssues;]');
      expect(steps.find((s) => s.publish === 'reports/pw-perf')?.condition).toBe('always()');
      expect(steps.find((s) => s.publish === 'pw-perf-thresholds')?.condition).toContain(
        "'thresholds'",
      );
    }
  });

  test('16-AC-09 the recipes publish reports/pw-perf/junit.xml without changing the job status', () => {
    const JUNIT = 'reports/pw-perf/junit.xml';
    // GitLab: the perf job reports it next to the artifact paths, always.
    const gitlab = yaml('gitlab-ci.yml');
    const perf = obj(obj(gitlab.perf, 'perf').artifacts, 'artifacts');
    expect(perf.when).toBe('always');
    expect(obj(perf.reports, 'reports').junit).toBe(JUNIT);
    expect(obj(gitlab['perf-thresholds'], 'perf-thresholds').artifacts).not.toHaveProperty(
      'reports',
    );
    // Jenkins: the JUnit step in post/always, empty results allowed, status from outcome.json.
    expect(read('Jenkinsfile')).toMatch(
      /always \{[^}]*junit testResults: 'reports\/pw-perf\/junit\.xml', allowEmptyResults: true, skipMarkingBuildUnstable: true/u,
    );
    // Azure: PublishTestResults@2 in mode test only, never failing the task.
    const azure = yaml('azure-pipelines.yml');
    const steps = list(obj(list(azure.jobs, 'jobs')[0], 'job').steps, 'steps').map((s, i) =>
      obj(s, `step ${i}`),
    );
    const publish = steps.find((s) => s.task === 'PublishTestResults@2');
    expect(publish?.condition).toBe("and(always(), eq('${{ parameters.mode }}', 'test'))");
    expect(obj(publish?.inputs, 'inputs')).toEqual({
      testResultsFormat: 'JUnit',
      testResultsFiles: JUNIT,
      testRunTitle: 'pw-perf',
      failTaskOnFailedTests: false,
      failTaskOnMissingResultsFile: false,
    });
    // GitHub: the file is in the artifact; a test report action only as a comment (16-D-05).
    const github = read('github-actions.yml');
    expect(github).toContain(`#     report_paths: ${JUNIT}`);
    expect(github).not.toMatch(/^\s+uses: mikepenz\//mu);
    expect(github).not.toMatch(/^\s+checks: write/mu);
  });

  test('04-AC-49 Jenkins: balanced declarative pipeline, MODE parameter, UNSTABLE on 2, archive always', () => {
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
    for (const block of [
      'agent',
      'parameters',
      'options',
      'triggers',
      'environment',
      'stages',
      'post',
    ]) {
      expect(code).toMatch(new RegExp(`^ {2}${block}\\b`, 'mu'));
    }
    expect(text).toContain("choices: ['test', 'thresholds']");
    expect(text).toContain("cron('H 3 * * 1')");
    expect(text).toContain("sh(script: 'npm run e2e', returnStatus: true)");
    expect(text).toMatch(/if \(code == '2'\) \{\s+unstable\(/u);
    expect(text).toMatch(
      /always \{\s+archiveArtifacts artifacts: 'pw-perf-thresholds\*\.json, reports\/pw-perf\/\*\*'/u,
    );
  });
});
