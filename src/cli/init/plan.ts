// The change plan of the init wizard (04-REQ-38 step 7, 04-REQ-39, 04-REQ-40, 04-REQ-42,
// 04-REQ-67): file changes for recognized layouts, manual instructions (INIT_MANUAL_STEP) for
// everything else. Test files are never changed: only a fixtures module is wrapped, otherwise the
// wizard shows the red box of INIT_TEST_OBJECT_MANUAL. package.json is never changed (D-35).
// Idempotent: a project that already has a change gets no second one. Pure.
import { DEFAULT_CONFIG } from '../../core/config/index.ts';
import { stringifyStable } from '../../core/format/index.ts';
import { SCHEMA_VERSIONS } from '../../core/schema/index.ts';
import { PACKAGE_NAME } from '../../core/types/index.ts';
import type { CliIssue } from '../../core/types/index.ts';
import { EXTEND_CALL, PERF_CONFIG_NAMES, SOURCE_FILE } from './detect.ts';
import {
  importSpecifiers,
  resolveImport,
  tsconfigAliases,
  tsconfigAllowsTsExtensions,
  workspaceKey,
} from './imports.ts';
import type { ProjectInfo } from './detect.ts';
import { translator } from './messages.ts';
import type { Translate, WizardLanguage } from './messages.ts';
import { activeValues, renderPerfConfig, ts } from './perf-config.ts';
import type { InitAnswers, PerfConfigFormat } from './perf-config.ts';
import {
  addIgnore,
  ignores,
  perfConfigRef,
  swapTestImport,
  wrapPlaywrightConfig,
  wrapTestObject,
} from './patterns.ts';
import type { PerfConfigRef } from './patterns.ts';

export interface FileChange {
  path: string;
  kind: 'create' | 'modify';
  before: string | null;
  after: string;
}

/** The red box of 04-REQ-67: the test object could not be wrapped without changing test files. */
export interface TestObjectBox {
  /**
   * Files with `.extend(` (candidates for the fixtures module) and fixtures modules of workspace
   * packages, the most imported by test files first (04-D-49).
   */
  extendFiles: string[];
  /** Test files that import each of extendFiles (04-D-49). */
  importedBy: Record<string, number>;
  /** extendFiles in workspace packages: path → package name (04-D-49). */
  workspace: Record<string, string>;
  /** Number of files that import from @playwright/test. */
  importingFiles: number;
  /**
   * test.step durations are measured without the fixture (answer all, test.step found): the box
   * says endpoints are not measured yet, and the check step is shown (04-D-47).
   */
  stepsMeasured: boolean;
}

export interface InitPlan {
  changes: FileChange[];
  manualSteps: CliIssue[];
  /** Set when nothing would be measured until the user wraps the test object (04-REQ-67). */
  testObject: TestObjectBox | null;
  /**
   * Tests that import test straight from @playwright/test and no fixtures module (04-D-49): the
   * import changes in `paths` (part of `changes`); the red box `box` applies unless every one of
   * them is applied.
   */
  importSwap: { paths: string[]; box: TestObjectBox } | null;
}

/**
 * The package config file the wizard writes (04-REQ-46, 04-D-48): pw-perf.config.ts in a
 * TypeScript project; in a JavaScript project a file in the module system of playwright.config,
 * `.js` when that system is the package default, else `.mjs`/`.cjs`.
 */
export function perfConfigFile(info: ProjectInfo): { path: string; format: PerfConfigFormat } {
  if (info.typescript) return { path: 'pw-perf.config.ts', format: 'ts' };
  const format = info.moduleType;
  const ext = format === info.packageModule ? 'js' : format === 'esm' ? 'mjs' : 'cjs';
  return { path: `pw-perf.config.${ext}`, format };
}

/** The package config file playwright.config refers to: the existing one, else the new one. */
function perfConfigReference(info: ProjectInfo, answers: InitAnswers): PerfConfigRef {
  const existing = info.existing.perfConfig;
  const tsExtensions = tsconfigAllowsTsExtensions(info.files.get('tsconfig.json'));
  if (existing !== null) {
    return perfConfigRef(existing, info.files.get(existing) ?? null, tsExtensions);
  }
  const file = perfConfigFile(info);
  return perfConfigRef(file.path, renderPerfConfig(answers, file.format), tsExtensions);
}

function manual(message: string, hint: string): CliIssue {
  return { code: 'INIT_MANUAL_STEP', message, hint };
}

function change(info: ProjectInfo, path: string, after: string): FileChange | null {
  const before = info.files.get(path) ?? null;
  if (before === after) return null;
  return { path, kind: before === null ? 'create' : 'modify', before, after };
}

const CONFIG_HINT = (t: Translate, path: string, perf: PerfConfigRef): string =>
  [
    t('configHintIntro'),
    `  import { withPerf } from '${PACKAGE_NAME}/config';`,
    `  import perfConfig from '${perf.import}';`,
    `  export default withPerf(otherWrapper(defineConfig({ ... })), perfConfig);`,
    t('configHintCjs', { path, call: `withPerf(config, ${perf.require})` }),
  ].join('\n');

function planPerfConfig(
  info: ProjectInfo,
  answers: InitAnswers,
  plan: InitPlan,
  t: Translate,
): void {
  const existing = info.existing.perfConfig;
  const file = perfConfigFile(info);
  if (existing === null || existing === file.path) {
    const c = change(info, file.path, renderPerfConfig(answers, file.format));
    if (c !== null) plan.changes.push(c);
    return;
  }
  // Another format: never rewritten; the answers are listed for the user to copy (04-REQ-40).
  const values = [...activeValues(answers)].map(([path, value]) => `${path} = ${ts(value)}`);
  if (values.length > 0) {
    plan.manualSteps.push(
      manual(
        t('manualPerfConfigKept', { file: existing }),
        `${t('manualPerfConfigHint')}\n${values.map((v) => `  ${v}`).join('\n')}`,
      ),
    );
  }
}

function planPlaywrightConfig(
  info: ProjectInfo,
  answers: InitAnswers,
  plan: InitPlan,
  t: Translate,
): void {
  const config = info.playwrightConfig;
  if (config === null || info.existing.wrappedConfig) return;
  const existing = info.existing.perfConfig;
  if (existing !== null && existing.endsWith('.json')) {
    const json = `./${existing}`;
    plan.manualSteps.push(
      manual(
        t('manualConfigJson', { config: config.path, file: existing }),
        CONFIG_HINT(t, config.path, { import: json, require: `require('${json}')` }),
      ),
    );
    return;
  }
  const perf = perfConfigReference(info, answers);
  const after = wrapPlaywrightConfig(config.text, perf);
  if (after === null) {
    plan.manualSteps.push(
      manual(t('manualConfigPattern', { config: config.path }), CONFIG_HINT(t, config.path, perf)),
    );
    return;
  }
  plan.changes.push({ path: config.path, kind: 'modify', before: config.text, after });
}

/** A test call with a title at the start of a line: the file is a test file, not a module. */
const TEST_CALL =
  /^\s*(?:test|it)(?:\.(?:describe|only|skip|fixme|fail|serial|parallel|step)(?:\.\w+)?)?\s*\(\s*['"`]/mu;

/** Named imports from @playwright/test: `import { … } from` or `const { … } = require(`. */
const PLAYWRIGHT_TEST_NAMES =
  /\bimport\s*\{([^}]*)\}\s*from\s*(['"])@playwright\/test\2|\{([^}]*)\}\s*=\s*require\s*\(\s*(['"])@playwright\/test\4\s*\)/gu;

/**
 * A test file that takes `test` from @playwright/test: it imports the value `test` (alone or
 * renamed, e.g. `test as setup`) and is named `*.spec.*`/`*.test.*` or calls it with a title at
 * the start of a line. Page objects (`type Page`, `test.step`) and fixtures modules are not
 * counted (04-REQ-72).
 */
function isPlaywrightTestFile(path: string, source: string): boolean {
  const aliases: string[] = [];
  if (/\brequire\s*\(\s*(['"])@playwright\/test\1\s*\)\s*\.test\b/u.test(source))
    aliases.push('test');
  for (const m of source.matchAll(PLAYWRIGHT_TEST_NAMES)) {
    for (const name of (m[1] ?? m[3] ?? '').split(',')) {
      const alias = /^\s*test\s*(?:(?:as|:)\s*([A-Za-z_$][\w$]*))?\s*$/u.exec(name);
      if (alias !== null) aliases.push(alias[1] ?? 'test');
    }
  }
  if (aliases.length > 0 && /\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(path)) return true;
  return aliases.some((alias) =>
    new RegExp(
      String.raw`^\s*${alias.replaceAll('$', '\\$')}(?:\.\w+)*\s*\(\s*['"\x60]`,
      'mu',
    ).test(source),
  );
}

/** A setup or teardown file (`auth.setup.ts`, `test as setup`): not a measured test. */
function isSetupFile(path: string, source: string): boolean {
  if (/\.(?:setup|teardown)\.[cm]?[jt]sx?$/u.test(path)) return true;
  return /\btest\s+as\s+(?:setup|teardown)\b|\btest\s*:\s*(?:setup|teardown)\b/u.test(source);
}

/** Source files that are test files: `*.spec.*`/`*.test.*` or a test call at a line start. */
function testFiles(info: ProjectInfo): string[] {
  return [...info.files.keys()].filter(
    (path) =>
      SOURCE_FILE.test(path) &&
      !path.startsWith('node_modules/') &&
      !path.startsWith('../') &&
      (/\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(path) || TEST_CALL.test(info.files.get(path) ?? '')),
  );
}

/**
 * Fixtures modules of workspace packages the tests import by name (04-D-49): the package entry
 * file with exactly one `.extend(` that exports test, as in 04-REQ-67. Never changed by the
 * wizard (another package), only named in the red box.
 */
function workspaceFixtures(info: ProjectInfo): Record<string, string> {
  const found: Record<string, string> = {};
  const prefix = 'node_modules/';
  for (const [key, path] of info.files) {
    const name = key.startsWith(prefix) ? key.slice(prefix.length, key.lastIndexOf('/')) : '';
    if (key !== workspaceKey(name)) continue;
    const text = info.files.get(path) ?? '';
    if ([...text.matchAll(EXTEND_CALL)].length === 1 && wrapTestObject(text) !== null)
      found[path] = name;
  }
  return found;
}

/** How many test files import each of `targets` (04-D-49). */
function importCounts(info: ProjectInfo, targets: readonly string[]): Record<string, number> {
  const aliases = tsconfigAliases(info.files.get('tsconfig.json'));
  const counts: Record<string, number> = Object.fromEntries(targets.map((t) => [t, 0]));
  for (const file of testFiles(info)) {
    const seen = new Set<string>();
    for (const specifier of importSpecifiers(info.files.get(file) ?? '')) {
      const target = resolveImport(file, specifier, info.files, aliases);
      if (target !== null && target in counts && !seen.has(target)) {
        seen.add(target);
        counts[target] = (counts[target] as number) + 1;
      }
    }
  }
  return counts;
}

/**
 * @playwright/test as a whole: a namespace or default import, or `require()` of the module
 * object; the import of such a file cannot be changed by name (04-D-49).
 */
const OPAQUE_PLAYWRIGHT_IMPORT =
  /\bimport\s+(?:\*\s*as\s+[\w$]+|[\w$]+)\s*(?:,[^;]*?)?\bfrom\s*(['"])@playwright\/test\1|\b(?:const|let|var)\s+[\w$]+\s*=\s*require\s*\(\s*(['"])@playwright\/test\2\s*\)|\brequire\s*\(\s*(['"])@playwright\/test\3\s*\)\s*\.\s*test\b/u;

/** Test files (not setup files) that take `test` straight from @playwright/test. */
function directTestFiles(info: ProjectInfo): string[] {
  const text = (path: string): string => info.files.get(path) ?? '';
  return info.filesImportingPlaywrightTest.filter(
    (p) => isPlaywrightTestFile(p, text(p)) && !isSetupFile(p, text(p)),
  );
}

function planTestObject(
  info: ProjectInfo,
  answers: InitAnswers,
  plan: InitPlan,
  t: Translate,
): void {
  const text = (path: string): string => info.files.get(path) ?? '';
  const direct = directTestFiles(info);
  /** The yellow warning of 04-D-49: some tests are still not measured. */
  const warnDirect = (module: string | null): void => {
    if (direct.length === 0 || answers.measure === 'steps') return;
    plan.manualSteps.push(
      manual(
        t('manualDirectImports', { count: direct.length, files: direct.join(', ') }),
        [
          t(module === null ? 'manualDirectImportsHint' : 'manualDirectImportsModuleHint', {
            module: module ?? '',
          }),
          `  import { test, expect } from '${PACKAGE_NAME}/test';`,
        ].join('\n'),
      ),
    );
  };
  if (info.existing.wrappedTest) {
    warnDirect(null);
    return;
  }
  const extendFiles = info.filesWithExtend;
  const merges = info.filesImportingPlaywrightTest.filter((p) =>
    /\bmergeTests\s*\(/u.test(text(p)),
  );
  const only = extendFiles.length === 1 && merges.length === 0 ? (extendFiles[0] as string) : null;
  const after =
    only !== null &&
    [...text(only).matchAll(EXTEND_CALL)].length === 1 &&
    !TEST_CALL.test(text(only))
      ? wrapTestObject(text(only))
      : null;
  if (only !== null && after !== null) {
    plan.changes.push({ path: only, kind: 'modify', before: text(only), after });
    warnDirect(only);
    return;
  }
  // Only steps measured: the reporter records them without the perf fixture (06), so something
  // is measured and there is no red box (v4 D5).
  if (answers.measure === 'steps') return;
  const workspace = workspaceFixtures(info);
  const candidates = [...new Set([...extendFiles, ...merges, ...Object.keys(workspace)])];
  const importedBy = importCounts(info, candidates);
  const box: TestObjectBox = {
    extendFiles: candidates.sort(
      (a, b) =>
        (importedBy[b] as number) - (importedBy[a] as number) || (a < b ? -1 : a > b ? 1 : 0),
    ),
    importedBy,
    workspace,
    // Test files only: page objects and fixtures modules import @playwright/test too (04-REQ-72).
    importingFiles: info.filesImportingPlaywrightTest.filter((p) =>
      isPlaywrightTestFile(p, text(p)),
    ).length,
    stepsMeasured: answers.measure === 'all' && info.stepFiles > 0,
  };
  // Tests that import test straight from @playwright/test and no fixtures module: the import
  // changes as diffs (04-D-49). One file the wizard cannot change keeps the red box alone.
  const opaque = testFiles(info).some(
    (p) => !isSetupFile(p, text(p)) && OPAQUE_PLAYWRIGHT_IMPORT.test(text(p)),
  );
  const swaps =
    candidates.length === 0 && !opaque ? direct.map((p) => [p, swapTestImport(text(p))]) : [];
  if (swaps.length > 0 && swaps.every(([, a]) => a !== null)) {
    for (const [path, swapped] of swaps)
      plan.changes.push({
        path: path as string,
        kind: 'modify',
        before: text(path as string),
        after: swapped as string,
      });
    plan.importSwap = { paths: direct, box };
    return;
  }
  plan.testObject = box;
}

/** Contexts of request.newContext() that are not tracked (04-REQ-74): a manual step. */
function planRequestContexts(
  info: ProjectInfo,
  answers: InitAnswers,
  plan: InitPlan,
  t: Translate,
): void {
  const files = info.untrackedContextFiles;
  if (files.length === 0 || answers.measure === 'steps') return;
  plan.manualSteps.push(
    manual(
      t('manualNewContext', { count: files.length, files: files.join(', ') }),
      [
        t('manualNewContextHint'),
        `  import { trackRequestContext } from '${PACKAGE_NAME}/fixture';`,
        '  const ctx = await request.newContext();',
        '  trackRequestContext(ctx);',
      ].join('\n'),
    ),
  );
}

function planGitignore(info: ProjectInfo, plan: InitPlan): void {
  const dir = DEFAULT_CONFIG.report.dir;
  const current = info.files.get('.gitignore') ?? null;
  if (current !== null && ignores(current, dir)) return;
  const c = change(info, '.gitignore', addIgnore(current, dir));
  if (c !== null) plan.changes.push(c);
}

/**
 * Names of the thresholds files the wizard creates empty (04-REQ-75): the default thresholds.dir
 * (the config directory) and filePrefix of the config file it writes, without an environment
 * label (the wizard does not know one).
 */
export function emptyThresholdsFiles(): { path: string; kind: 'api' | 'step' }[] {
  const prefix = DEFAULT_CONFIG.thresholds.filePrefix;
  return [
    { path: `${prefix}.json`, kind: 'api' },
    { path: `${prefix}.steps.json`, kind: 'step' },
  ];
}

/**
 * Empty thresholds files for api and steps whatever step 4 answered (04-REQ-75, 04-D-55): valid
 * against the schema, without entries; an existing file is never changed.
 */
function planThresholdsFiles(info: ProjectInfo, plan: InitPlan): void {
  for (const { path, kind } of emptyThresholdsFiles()) {
    if (info.files.has(path)) continue;
    const after = stringifyStable({
      schemaVersion: SCHEMA_VERSIONS.thresholds,
      kind,
      generated: null,
      entries: {},
    });
    plan.changes.push({ path, kind: 'create', before: null, after });
  }
}

/**
 * Pure plan of the init changes; unrecognized layouts give manual steps (04-REQ-39) in the wizard
 * language (04-REQ-43). The file changes do not depend on the language.
 */
export function planInitChanges(
  info: ProjectInfo,
  answers: InitAnswers,
  lang: WizardLanguage = 'en',
): InitPlan {
  const t = translator(lang);
  const plan: InitPlan = { changes: [], manualSteps: [], testObject: null, importSwap: null };
  planPerfConfig(info, answers, plan, t);
  planPlaywrightConfig(info, answers, plan, t);
  planTestObject(info, answers, plan, t);
  planRequestContexts(info, answers, plan, t);
  planGitignore(info, plan);
  planThresholdsFiles(info, plan);
  return plan;
}

/** Whether `path` is an existing package config, which needs its own confirmation (04-REQ-40). */
export function isProtected(info: ProjectInfo, path: string): boolean {
  return PERF_CONFIG_NAMES.includes(path) && info.existing.perfConfig === path;
}
