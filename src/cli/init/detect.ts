// Step 1 of the init wizard (04-REQ-38): text-only project detection. No user code is executed;
// playwright.config is read as text, never imported (04-REQ-39, 04-D-18). Pure: the caller
// reads the files (files.ts) and passes them as a map of project-relative paths with "/".
import {
  CONFIG_FILE_BASENAME,
  CONFIG_FILE_EXTENSIONS,
  PACKAGE_NAME,
} from '../../core/types/index.ts';

export type PackageManager = 'npm' | 'pnpm' | 'yarn';
export type CiPlatform = 'github' | 'gitlab' | 'jenkins' | 'azure';

export interface ProjectInfo {
  playwrightConfig: { path: string; text: string } | null;
  playwrightVersion: string | null;
  packageManager: PackageManager;
  moduleType: 'esm' | 'cjs';
  /** The module system of a `.js` file in the package ("type" in package.json). */
  packageModule: 'esm' | 'cjs';
  /** playwright.config is TypeScript or tsconfig.json lies next to it (04-REQ-46). */
  typescript: boolean;
  testDir: string;
  filesImportingPlaywrightTest: string[];
  filesWithExtend: string[];
  taggedPerfTestFiles: number;
  /** Source files with a test.step( call (04-REQ-47). */
  stepFiles: number;
  ciPlatform: CiPlatform | null;
  existing: {
    perfConfig: string | null;
    wrappedConfig: boolean;
    wrappedTest: boolean;
    scripts: string[];
  };
  /** The files detection read (the input map); the change plan works on their text. */
  files: ReadonlyMap<string, string>;
}

/** playwright.config file names, in the order they are looked up. */
export const PLAYWRIGHT_CONFIG_NAMES: readonly string[] = [
  'ts',
  'mts',
  'cts',
  'js',
  'mjs',
  'cjs',
].map((ext) => `playwright.config.${ext}`);

/** Package config file names (01, chapter 7.3). */
export const PERF_CONFIG_NAMES: readonly string[] = CONFIG_FILE_EXTENSIONS.map(
  (ext) => `${CONFIG_FILE_BASENAME}${ext}`,
);

/** Key of the installed @playwright/test manifest in the file map. */
export const INSTALLED_PLAYWRIGHT = 'node_modules/@playwright/test/package.json';

export const LOCKFILES: Readonly<Record<string, PackageManager>> = {
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'package-lock.json': 'npm',
};

/** CI markers in the order of 04-REQ-38 step 6. */
const CI_MARKERS: readonly [CiPlatform, (path: string) => boolean][] = [
  ['github', (p) => p.startsWith('.github/')],
  ['gitlab', (p) => p === '.gitlab-ci.yml'],
  ['jenkins', (p) => p === 'Jenkinsfile'],
  ['azure', (p) => p === 'azure-pipelines.yml'],
];

export const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const IMPORTS_PLAYWRIGHT_TEST =
  /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|^\s*import\s*)(['"])@playwright\/test\1/mu;
/** A `.extend(` call other than `expect.extend(` (custom matchers). */
export const EXTEND_CALL = /(?<!\bexpect)\.extend\s*[<(]/gu;
/**
 * A fixture definition: `({ page }, use`, an option or a worker fixture. With an import of
 * @playwright/test it marks a `.extend(` file as a fixtures module, so that `.extend(` in
 * application code (e.g. zod schemas) found by the project-wide scan is not one (04-REQ-72).
 */
const FIXTURE_SIGNATURE =
  /\(\s*\{[^{}]*\}\s*,\s*use\b|\boption\s*:\s*true\b|\bscope\s*:\s*['"]worker['"]/u;
const PERF_TAG = /@perf\b/u;
const WRAPPED_TEST = new RegExp(
  String.raw`\bwithPerfFixtures\s*\(|(['"])${PACKAGE_NAME}/test\1`,
  'u',
);

/** testDir values written as string literals in playwright.config ("." when there is none). */
export function testDirsOf(configText: string): string[] {
  const dirs = [...configText.matchAll(/\btestDir\s*:\s*(['"`])([^'"`\n]+)\1/gu)].map((m) =>
    normalizeDir(m[2] as string),
  );
  return dirs.length === 0 ? ['.'] : [...new Set(dirs)];
}

function normalizeDir(dir: string): string {
  const clean = dir
    .replaceAll('\\', '/')
    .replace(/^\.\/+/u, '')
    .replace(/\/+$/u, '');
  return clean === '' ? '.' : clean;
}

function parseJson(text: string | undefined): Record<string, unknown> | null {
  if (text === undefined) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringField(obj: Record<string, unknown> | null, ...keys: string[]): string | null {
  let value: unknown = obj;
  for (const key of keys) {
    if (typeof value !== 'object' || value === null) return null;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === 'string' ? value : null;
}

/** Version of @playwright/test: the installed one, else the version in the dependency range. */
function playwrightVersion(
  files: ReadonlyMap<string, string>,
  pkg: Record<string, unknown> | null,
): string | null {
  const installed = stringField(parseJson(files.get(INSTALLED_PLAYWRIGHT)), 'version');
  if (installed !== null) return installed;
  const range =
    stringField(pkg, 'devDependencies', '@playwright/test') ??
    stringField(pkg, 'dependencies', '@playwright/test');
  return range === null ? null : (/\d+\.\d+\.\d+/u.exec(range)?.[0] ?? null);
}

function packageManagerOf(
  files: ReadonlyMap<string, string>,
  pkg: Record<string, unknown> | null,
): PackageManager {
  for (const [file, manager] of Object.entries(LOCKFILES)) {
    if (files.has(file)) return manager;
  }
  const declared = /^(npm|pnpm|yarn)@/u.exec(stringField(pkg, 'packageManager') ?? '');
  return (declared?.[1] as PackageManager | undefined) ?? 'npm';
}

function sourceFiles(files: ReadonlyMap<string, string>, configPath: string | null): string[] {
  return [...files.keys()]
    .filter(
      (path) =>
        SOURCE_FILE.test(path) &&
        path !== configPath &&
        !path.startsWith('node_modules/') &&
        // Workspace package entries (files.ts) are outside the project: never changed.
        !path.startsWith('../') &&
        !path.includes('/node_modules/') &&
        !PERF_CONFIG_NAMES.includes(path),
    )
    .sort();
}

/** Text-only detection (04-REQ-38 step 1, 04-D-18). */
export function detectProject(files: ReadonlyMap<string, string>): ProjectInfo {
  const configPath = PLAYWRIGHT_CONFIG_NAMES.find((name) => files.has(name)) ?? null;
  const configText = configPath === null ? '' : (files.get(configPath) as string);
  const pkg = parseJson(files.get('package.json'));
  const sources = sourceFiles(files, configPath);
  const text = (path: string): string => files.get(path) ?? '';

  const moduleType: 'esm' | 'cjs' =
    configPath?.endsWith('.mts') || configPath?.endsWith('.mjs')
      ? 'esm'
      : configPath?.endsWith('.cts') || configPath?.endsWith('.cjs')
        ? 'cjs'
        : pkg?.['type'] === 'module'
          ? 'esm'
          : 'cjs';

  const packageModule: 'esm' | 'cjs' = pkg?.['type'] === 'module' ? 'esm' : 'cjs';
  const scripts = pkg?.['scripts'];
  const paths = [...files.keys()];
  return {
    playwrightConfig: configPath === null ? null : { path: configPath, text: configText },
    playwrightVersion: playwrightVersion(files, pkg),
    packageManager: packageManagerOf(files, pkg),
    moduleType,
    packageModule,
    typescript: configPath === null || /\.[cm]?ts$/u.test(configPath) || files.has('tsconfig.json'),
    testDir: testDirsOf(configText)[0] as string,
    filesImportingPlaywrightTest: sources.filter((p) => IMPORTS_PLAYWRIGHT_TEST.test(text(p))),
    filesWithExtend: sources.filter(
      (p) =>
        text(p).search(EXTEND_CALL) !== -1 &&
        (IMPORTS_PLAYWRIGHT_TEST.test(text(p)) || FIXTURE_SIGNATURE.test(text(p))),
    ),
    taggedPerfTestFiles: sources.filter((p) => PERF_TAG.test(text(p))).length,
    stepFiles: sources.filter((p) => text(p).includes('test.step(')).length,
    ciPlatform: CI_MARKERS.find(([, test]) => paths.some(test))?.[0] ?? null,
    existing: {
      perfConfig: PERF_CONFIG_NAMES.find((name) => files.has(name)) ?? null,
      wrappedConfig: /\bwithPerf\s*\(/u.test(configText),
      wrappedTest: sources.some((p) => WRAPPED_TEST.test(text(p))),
      scripts: typeof scripts === 'object' && scripts !== null ? Object.keys(scripts).sort() : [],
    },
    files,
  };
}
