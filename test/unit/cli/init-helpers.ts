// Helpers of the init tests: project inputs from test/integration/projects/init-*, the plan as
// one diff text, and copies of the projects in a temporary directory.
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { detectProject, readProjectFiles, unifiedDiff } from '../../../src/cli/init/index.ts';
import type { InitPlan, ProjectInfo } from '../../../src/cli/init/index.ts';
import { fakeCliHost } from './harness.ts';

export const PROJECTS = join(import.meta.dirname, '../../integration/projects');
export const INIT_GOLDEN = join(import.meta.dirname, '../../golden/init');

/** Detection of a project directory, without an installed Playwright. */
export async function detectDir(dir: string): Promise<ProjectInfo> {
  const fake = fakeCliHost({ cwd: dir, playwright: null });
  return detectProject(await readProjectFiles(fake.host, dir));
}

/** Diffs of all planned changes in path order (the order of snapshotDiff). */
export function planDiff(plan: InitPlan): string {
  return [...plan.changes]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(unifiedDiff)
    .join('');
}

/** A copy of test/integration/projects/<name> in a new temporary directory (with a space). */
export function copyProject(name: string): string {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'pw-perf init-'))), 'my project');
  cpSync(join(PROJECTS, name), dir, { recursive: true });
  copies.push(dir);
  return dir;
}

const copies: string[] = [];

/** Removes the copies made by copyProject (afterAll of the test files). */
export function removeCopies(): void {
  for (const dir of copies.splice(0)) rmSync(dirname(dir), { recursive: true, force: true });
}

/** Every file below `dir` except node_modules: relative path → text. */
export function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (sub: string): void => {
    for (const name of readdirSync(sub).sort()) {
      const path = join(sub, name);
      if (name === 'node_modules') continue;
      if (statSync(path).isDirectory()) walk(path);
      else files.set(relative(dir, path).replaceAll('\\', '/'), readFileSync(path, 'utf8'));
    }
  };
  walk(dir);
  return files;
}

/** Unified diff between two snapshots, in path order. */
export function snapshotDiff(before: Map<string, string>, after: Map<string, string>): string {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return paths
    .map((path) =>
      unifiedDiff({
        path,
        kind: before.has(path) ? 'modify' : 'create',
        before: before.get(path) ?? null,
        after: after.get(path) ?? '',
      }),
    )
    .join('');
}
