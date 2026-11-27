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
/** The basic recipes: the files of examples/ci, without the sharded/ folder. */
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
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

/**
 * Lexical check of a Jenkinsfile: strings and comments removed, then every string must be closed
 * on its line and the brackets must balance. Returns the code without strings.
 */
function groovy(text: string): string {
  const code = text
    .replace(/\/\/[^\n]*/gu, '')
    .replace(/"(?:[^"\\\n]|\\.)*"/gu, 'STR')
    .replace(/'(?:[^'\\\n]|\\.)*'/gu, 'STR');
  expect(code).not.toMatch(/["']/u);
  const stack: string[] = [];
  const pairs: Record<string, string> = { ')': '(', '}': '{', ']': '[' };
  for (const char of code) {
    if ('({['.includes(char)) stack.push(char);
    else if (char in pairs) expect(stack.pop(), `unbalanced ${char}`).toBe(pairs[char]);
  }
  expect(stack).toEqual([]);
  return code;
}

describe('13-AC-07 CI recipes in examples/ci', () => {
  test('there is one recipe per documented platform and docs/ci.md links each', () => {
    expect(files(DIR)).toEqual([
      'Jenkinsfile',
      'azure-pipelines.yml',
      'github-actions.yml',
      'gitlab-ci.yml',
    ]);
    const docs = readFileSync(join(import.meta.dirname, '../../docs/ci.md'), 'utf8');
    for (const name of files(DIR)) expect(docs).toContain(`../examples/ci/${name}`);
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
      // The thresholds run copies its files into reports/pw-perf (10-REQ-24): one folder is enough.
      expect(path).toBe('reports/pw-perf/');
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
    expect(obj(thresholds.artifacts, 'artifacts').paths).toEqual(['reports/pw-perf/']);
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
      // Both modes publish reports/pw-perf, which holds the thresholds files copies (10-REQ-24).
      expect(steps.filter((s) => s.publish !== undefined)).toHaveLength(1);
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
    const code = groovy(text);
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
    expect(text).toMatch(/always \{\s+archiveArtifacts artifacts: 'reports\/pw-perf\/\*\*'/u);
  });
});

describe('17-AC-10 sharded CI recipes in examples/ci/sharded', () => {
  const SHARDED = join(DIR, 'sharded');
  const text = (name: string): string => readFileSync(join(SHARDED, name), 'utf8');
  const strict = (name: string): Obj =>
    parse(text(name), { strict: true, uniqueKeys: true, prettyErrors: true }) as Obj;
  const ARTIFACT = 'reports/pw-perf/shard-*.json';

  test('one recipe per platform, each linked from docs/ci.md, with --shard and the merge mode', () => {
    expect(files(SHARDED)).toEqual([
      'Jenkinsfile',
      'azure-pipelines.yml',
      'github-actions.yml',
      'gitlab-ci.yml',
    ]);
    const docs = readFileSync(join(import.meta.dirname, '../../docs/ci.md'), 'utf8');
    for (const name of files(SHARDED)) {
      expect(docs).toContain(`../examples/ci/sharded/${name}`);
      expect(text(name)).toContain('--shard=');
      expect(text(name)).toMatch(/PW_PERF_MODE(: |=)merge/u);
    }
  });

  test('GitHub Actions: a shard matrix uploads shard-*.json, the merge job runs also after a failed shard', () => {
    const jobs = obj(strict('github-actions.yml').jobs, 'jobs');
    expect(Object.keys(jobs)).toEqual(['shard', 'merge']);
    const shard = obj(jobs.shard, 'shard');
    const strategy = obj(shard.strategy, 'strategy');
    expect(strategy['fail-fast']).toBe(false);
    const matrix = list(obj(strategy.matrix, 'matrix').shard, 'matrix.shard');
    const steps = list(shard.steps, 'steps').map((s, i) => obj(s, `step ${i}`));
    const run = String(steps.find((s) => String(s.run).includes('--shard'))?.run);
    expect(run).toContain(`--shard=\${{ matrix.shard }}/${String(matrix.length)}`);
    expect(run).toMatch(/outcome\.json'\)\.exitCode/u);
    const upload = steps.find((s) => String(s.uses).startsWith('actions/upload-artifact@'));
    expect(upload?.if).toBe('always()');
    expect(obj(upload?.with, 'with').path).toBe(ARTIFACT);
    const merge = obj(jobs.merge, 'merge');
    expect(merge.needs).toBe('shard');
    expect(merge.if).toBe('always()');
    expect(obj(merge.env, 'env').PW_PERF_MODE).toBe('merge');
    const mergeSteps = list(merge.steps, 'steps').map((s, i) => obj(s, `step ${i}`));
    // No browsers in the merge job.
    expect(mergeSteps.some((s) => String(s.run).includes('playwright install'))).toBe(false);
    expect(mergeSteps.some((s) => s.run === 'npx pw-perf')).toBe(true);
    const download = mergeSteps.find((s) =>
      String(s.uses).startsWith('actions/download-artifact@'),
    );
    expect(obj(download?.with, 'with')).toMatchObject({
      path: 'reports/pw-perf',
      'merge-multiple': true,
    });
  });

  test('GitLab CI: parallel shards keep shard-*.json, the merge needs them, code 2 is soft', () => {
    const file = strict('gitlab-ci.yml');
    const shard = obj(file['perf-shard'], 'perf-shard');
    expect(shard.parallel).toBe(4);
    expect(obj(shard.variables, 'variables').PW_PERF_MODE).toBe('$PERF_MODE');
    expect(list(shard.script, 'script').join('\n')).toContain(
      '--shard=$CI_NODE_INDEX/$CI_NODE_TOTAL',
    );
    expect(obj(shard.artifacts, 'artifacts')).toMatchObject({ when: 'always', paths: [ARTIFACT] });
    const merge = obj(file['perf-merge'], 'perf-merge');
    expect(merge.needs).toEqual(['perf-shard']);
    expect(obj(merge.variables, 'variables').PW_PERF_MODE).toBe('merge');
    expect(list(merge.rules, 'rules').every((r) => obj(r, 'rule').when === 'always')).toBe(true);
    expect(obj(merge.allow_failure, 'allow_failure').exit_codes).toBe(2);
    expect(list(merge.script, 'script')).toEqual(['npx pw-perf']);
    expect(obj(obj(merge.artifacts, 'artifacts').reports, 'reports').junit).toBe(
      'reports/pw-perf/junit.xml',
    );
  });

  test('Azure Pipelines: parallel shard job, the merge job runs after a failed shard', () => {
    const jobs = list(strict('azure-pipelines.yml').jobs, 'jobs').map((j, i) => obj(j, `job ${i}`));
    const [shard, merge] = jobs;
    expect(obj(shard?.strategy, 'strategy').parallel).toBe(4);
    expect(JSON.stringify(shard?.steps)).toContain(
      '--shard=$(System.JobPositionInPhase)/$(System.TotalJobsInPhase)',
    );
    expect(merge?.dependsOn).toBe('shard');
    expect(merge?.condition).toBe('succeededOrFailed()');
    expect(obj(merge?.variables, 'variables').PW_PERF_MODE).toBe('merge');
    const steps = JSON.stringify(merge?.steps);
    expect(steps).toContain('npx pw-perf');
    expect(steps).toContain('##vso[task.complete result=SucceededWithIssues;]');
    expect(steps).not.toContain('playwright install');
  });

  test('Jenkins: parallel shard branches stash shard-*.json, the merge unstashes each in try', () => {
    const source = text('Jenkinsfile');
    const code = groovy(source);
    expect(code).toMatch(/^pipeline \{/mu);
    expect(source).toContain('npm run e2e -- --shard=${n}/${SHARDS}');
    expect(source).toContain(`includes: '${ARTIFACT}', allowEmpty: true`);
    expect(source).toMatch(/try \{\s+unstash "pw-perf-shard-\$\{i\}"/u);
    expect(source).toContain("withEnv(['PW_PERF_MODE=merge'])");
    expect(source).toMatch(/if \(code == 2\) \{\s+unstable\(/u);
  });
});
