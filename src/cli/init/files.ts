// Reads the project files the init detection needs (04-REQ-38 step 1): root files, CI files and
// the source files of the test directories, as text. Nothing is imported or executed (04-D-18).
import { DEFAULT_CONFIG } from '../../core/config/index.ts';
import type { CliHost } from '../host.ts';
import {
  INSTALLED_PLAYWRIGHT,
  LOCKFILES,
  PERF_CONFIG_NAMES,
  PLAYWRIGHT_CONFIG_NAMES,
  SOURCE_FILE,
  testDirsOf,
} from './detect.ts';

const ROOT_FILES = new Set([
  'package.json',
  '.gitignore',
  '.gitlab-ci.yml',
  'Jenkinsfile',
  'azure-pipelines.yml',
  ...PLAYWRIGHT_CONFIG_NAMES,
  ...PERF_CONFIG_NAMES,
]);
/** Files written by the wizard's CI step (ci.ts), read to keep the wizard idempotent. */
const ROOT_CI_FILE =
  /^(?:Jenkinsfile\.perf(?:-[a-z0-9-]+)?|azure-pipelines\.perf(?:-[a-z0-9-]+)?\.yml)$/u;
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  'test-results',
  'playwright-report',
  'blob-report',
]);
const MAX_DEPTH = 8;
const MAX_FILES = 3000;

/** Project files relative to `root` with "/" separators, as detectProject() takes them. */
export async function readProjectFiles(host: CliHost, root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const join = (rel: string): string => host.paths.join(root, rel);
  const read = async (rel: string): Promise<void> => {
    const text = await host.readText(join(rel));
    if (text !== null) files.set(rel, text);
  };

  for (const entry of await host.listDir(root)) {
    if (entry.directory) continue;
    if (Object.hasOwn(LOCKFILES, entry.name)) files.set(entry.name, '');
    else if (ROOT_FILES.has(entry.name) || ROOT_CI_FILE.test(entry.name)) await read(entry.name);
  }
  for (const dir of ['.github', '.github/workflows', '.gitlab']) {
    for (const entry of await host.listDir(join(dir))) {
      if (!entry.directory && /\.ya?ml$/u.test(entry.name)) await read(`${dir}/${entry.name}`);
    }
  }

  const playwright = host.resolvePlaywright(root);
  if (playwright !== null)
    files.set(INSTALLED_PLAYWRIGHT, JSON.stringify({ version: playwright.version }));

  const config = PLAYWRIGHT_CONFIG_NAMES.find((name) => files.has(name));
  if (config === undefined) return files;
  let count = 0;
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || rel.split('/').includes('..')) return;
    for (const entry of await host.listDir(rel === '.' ? root : join(rel))) {
      if (count >= MAX_FILES) return;
      const path = rel === '.' ? entry.name : `${rel}/${entry.name}`;
      if (entry.directory) {
        const skip =
          SKIP_DIRS.has(entry.name) ||
          entry.name.startsWith('.') ||
          path === DEFAULT_CONFIG.report.dir;
        if (!skip) await walk(path, depth + 1);
      } else if (SOURCE_FILE.test(entry.name) && !files.has(path)) {
        count += 1;
        await read(path);
      }
    }
  };
  for (const dir of testDirsOf(files.get(config) as string)) await walk(dir, 0);
  return files;
}
