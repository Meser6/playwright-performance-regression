// Structure of the GitHub Actions workflows of this repository (13, chapters 5–6; 12, chapter 7):
// the CI matrix, the scheduled runs and their artifacts, pinned actions. CI also runs actionlint
// on every workflow.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parse } from 'yaml';

const ROOT = join(import.meta.dirname, '../..');
const DIR = join(ROOT, '.github/workflows');

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Job {
  name?: string;
  permissions?: Record<string, string>;
  environment?: string | { name: string };
  outputs?: Record<string, string>;
  'runs-on'?: string;
  'continue-on-error'?: boolean;
  needs?: string | string[];
  if?: string;
  uses?: string;
  strategy?: { matrix?: Record<string, unknown> & { include?: Record<string, unknown>[] } };
  steps?: Step[];
}
interface Workflow {
  on: Record<string, unknown>;
  jobs: Record<string, Job>;
}

function workflow(name: string): Workflow {
  return parse(readFileSync(join(DIR, name), 'utf8'), { strict: true, uniqueKeys: true });
}
const job = (wf: Workflow, id: string): Job => {
  const found = wf.jobs[id];
  if (found === undefined) throw new Error(`job ${id} is missing`);
  return found;
};
const runs = (j: Job): string[] =>
  (j.steps ?? []).flatMap((s) => (s.run === undefined ? [] : [s.run]));

/** IDs of 12-PERF-NN / 12-STAT-NN found in the test titles of `dir`. */
function idsInTests(dir: string, pattern: RegExp): string[] {
  const ids = new Set<string>();
  for (const name of readdirSync(join(ROOT, dir))) {
    if (!name.endsWith('.test.ts')) continue;
    for (const match of readFileSync(join(ROOT, dir, name), 'utf8').matchAll(pattern)) {
      ids.add(match[0]);
    }
  }
  return [...ids].sort();
}

describe('workflows', () => {
  test('13-REQ-08 every action is pinned to a commit SHA', () => {
    for (const name of readdirSync(DIR)) {
      const wf = workflow(name);
      for (const [id, j] of Object.entries(wf.jobs)) {
        for (const step of j.steps ?? []) {
          if (step.uses !== undefined) {
            expect(step.uses, `${name} ${id}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/u);
          }
        }
      }
    }
  });

  test('13-REQ-09 the CI matrix: Linux Node 22/24/26 x Playwright minimum/latest, macOS and Windows Node 22/26 with the latest Playwright', () => {
    const ci = workflow('ci.yml');
    expect(Object.keys(ci.on).sort()).toEqual(['pull_request', 'push', 'workflow_call']);
    const matrix = job(ci, 'test').strategy?.matrix;
    expect(matrix?.['os']).toEqual(['ubuntu-24.04']);
    expect(matrix?.['node']).toEqual([22, 24, 26]);
    expect(matrix?.['playwright']).toEqual(['minimum', 'latest']);
    expect(matrix?.include).toEqual([
      { os: 'macos-latest', node: 22, playwright: 'latest' },
      { os: 'macos-latest', node: 26, playwright: 'latest' },
      { os: 'windows-latest', node: 22, playwright: 'latest' },
      { os: 'windows-latest', node: 26, playwright: 'latest' },
    ]);
    expect(runs(job(ci, 'test'))).toEqual(expect.arrayContaining(['pnpm build', 'pnpm test']));
    const browsers = job(ci, 'browsers');
    expect(browsers['continue-on-error']).toBe(true);
    expect(runs(browsers).join('\n')).toContain('firefox webkit');
  });

  test('13-REQ-11 the checks job runs every package check', () => {
    const checks = runs(job(workflow('ci.yml'), 'checks'));
    for (const command of [
      'pnpm lint',
      'pnpm format:check',
      'pnpm typecheck',
      'pnpm check:types-generated',
      'pnpm check:docs-generated',
      'pnpm check:packages',
      'pnpm publint',
      'pnpm attw',
      'pnpm check:ac',
    ]) {
      expect(checks, command).toContain(command);
    }
  });

  test('12-AC-04 the nightly and weekly runs upload the 12-PERF and 12-STAT results as artifacts', () => {
    expect(idsInTests('test/perf', /12-PERF-\d\d/gu)).toEqual([
      '12-PERF-01',
      '12-PERF-02',
      '12-PERF-03',
      '12-PERF-04',
    ]);
    expect(idsInTests('test/stats', /12-STAT-\d\d/gu)).toEqual([
      '12-STAT-01',
      '12-STAT-02',
      '12-STAT-03',
    ]);
    for (const [file, id, command] of [
      ['nightly.yml', 'perf', 'pnpm test:perf'],
      ['weekly.yml', 'stats', 'pnpm test:stats'],
    ] as const) {
      const wf = workflow(file);
      expect(Object.keys(wf.on), file).toContain('schedule');
      const steps = job(wf, id).steps ?? [];
      const testStep = steps.find((s) => s.run === command);
      const resultsDir = testStep?.env?.['PERF_RESULTS_DIR'];
      expect(resultsDir, file).toBeTypeOf('string');
      const upload = steps.find((s) => s.uses?.startsWith('actions/upload-artifact@'));
      expect(upload?.if, file).toBe('always()');
      expect(upload?.with?.['path'], file).toBe(resultsDir);
    }
  });

  test('13-REQ-10 04-REQ-05 the weekly run tests Playwright next and option collisions and opens an issue on failure', () => {
    const weekly = workflow('weekly.yml');
    expect(runs(job(weekly, 'playwright-next')).join('\n')).toContain('@playwright/test@next');
    expect(runs(job(weekly, 'playwright-next'))).toContain('pnpm test');
    expect(job(weekly, 'option-collisions').strategy?.matrix?.['playwright']).toEqual([
      'latest',
      'next',
    ]);
    expect(runs(job(weekly, 'option-collisions')).join('\n')).toContain('-t 04-AC-02');
    const report = job(weekly, 'report-failure');
    expect(report.needs).toEqual(['playwright-next', 'option-collisions', 'stats']);
    expect(report.if).toBe("failure() && github.event_name == 'schedule'");
    expect(runs(report).join('\n')).toContain('gh issue create');
  });

  test('13-AC-03 13-REQ-06 the release runs the full CI and the performance tests before publishing', () => {
    const release = workflow('release.yml');
    expect(release.on).toEqual({ push: { tags: ['v*'] } });
    expect(job(release, 'ci').uses).toBe('./.github/workflows/ci.yml');
    expect(job(release, 'perf').uses).toBe('./.github/workflows/nightly.yml');
    expect(Object.keys(workflow('ci.yml').on)).toContain('workflow_call');
    expect(Object.keys(workflow('nightly.yml').on)).toContain('workflow_call');
    expect(job(release, 'ci').needs).toBe('prepare');
    expect(job(release, 'publish').needs).toEqual(['prepare', 'ci', 'perf']);
    for (const id of ['github-release', 'create-smoke']) {
      expect(job(release, id).needs, id).toEqual(['prepare', 'publish']);
    }
  });

  test('13-REQ-06 13-REQ-07 the preconditions check the tag, both versions, the CHANGELOG and "private"', () => {
    const prepare = runs(job(workflow('release.yml'), 'prepare')).join('\n');
    expect(prepare).toContain('git merge-base --is-ancestor "$GITHUB_SHA" origin/main');
    expect(prepare).toContain('node scripts/check-release.mjs "$GITHUB_REF_NAME"');
  });

  test('13-REQ-06 13-D-05 both packages are published with provenance through trusted publishing', () => {
    const release = workflow('release.yml');
    const publish = job(release, 'publish');
    expect(publish.permissions).toEqual({ contents: 'read', 'id-token': 'write' });
    const text = runs(publish).join('\n');
    expect(text).toContain('for dir in . create; do');
    expect(text).toContain('npm publish --provenance --access public --tag "$DIST_TAG"');
    expect(text).toContain('pnpm check:packages');
    // No npm token anywhere: trusted publishing only.
    expect(readFileSync(join(DIR, 'release.yml'), 'utf8')).not.toMatch(
      /NPM_TOKEN|NODE_AUTH_TOKEN/u,
    );
    expect(runs(job(release, 'github-release')).join('\n')).toContain('--notes-file');
  });

  test('13-AC-10 the release runs the create package from npm with npm, pnpm and yarn', () => {
    const smoke = job(workflow('release.yml'), 'create-smoke');
    expect(smoke.strategy?.matrix?.['package-manager']).toEqual(['npm', 'pnpm', 'yarn']);
    const step = (smoke.steps ?? []).find((s) => s.run === 'pnpm vitest run test/release');
    expect(step?.env?.['RELEASE_VERSION']).toBe('${{ needs.prepare.outputs.version }}');
  });

  test('13-REQ-17 the demo report is deployed to GitHub Pages after a stable release or by hand', () => {
    const release = workflow('release.yml');
    const demoJob = job(release, 'demo');
    expect(demoJob.uses).toBe('./.github/workflows/demo.yml');
    expect(demoJob.if).toBe("needs.prepare.outputs.dist-tag == 'latest'");
    const demo = workflow('demo.yml');
    expect(Object.keys(demo.on).sort()).toEqual(['workflow_call', 'workflow_dispatch']);
    expect(runs(job(demo, 'build'))).toContain(
      'node scripts/build-demo-report.mjs --out "$RUNNER_TEMP/demo"',
    );
    const deploy = job(demo, 'deploy');
    expect(deploy.if).toBe('${{ !github.event.repository.private }}');
    expect(deploy.permissions).toEqual({ pages: 'write', 'id-token': 'write' });
  });
});
