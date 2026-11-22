// The change plan of the init wizard (04-REQ-38 step 7, 04-REQ-39, 04-REQ-40, 04-REQ-42,
// 04-REQ-67): file changes for recognized layouts, manual instructions (INIT_MANUAL_STEP) for
// everything else. Test files are never changed: only a fixtures module is wrapped, otherwise the
// wizard shows the red box of INIT_TEST_OBJECT_MANUAL. package.json is never changed (D-35).
// Idempotent: a project that already has a change gets no second one. Pure.
import { DEFAULT_CONFIG } from '../../core/config/index.ts';
import { PACKAGE_NAME } from '../../core/types/index.ts';
import type { CliIssue } from '../../core/types/index.ts';
import { ciFile } from './ci.ts';
import { EXTEND_CALL, PERF_CONFIG_NAMES } from './detect.ts';
import type { ProjectInfo } from './detect.ts';
import { translator } from './messages.ts';
import type { Translate, WizardLanguage } from './messages.ts';
import { activeValues, renderPerfConfig, ts } from './perf-config.ts';
import type { InitAnswers } from './perf-config.ts';
import { addIgnore, ignores, wrapPlaywrightConfig, wrapTestObject } from './patterns.ts';
import { testCommand } from './commands.ts';

export interface FileChange {
  path: string;
  kind: 'create' | 'modify';
  before: string | null;
  after: string;
}

/** The red box of 04-REQ-67: the test object could not be wrapped without changing test files. */
export interface TestObjectBox {
  /** Files with `.extend(` (candidates for the fixtures module). */
  extendFiles: string[];
  /** Number of files that import from @playwright/test. */
  importingFiles: number;
}

export interface InitPlan {
  changes: FileChange[];
  manualSteps: CliIssue[];
  /** Set when nothing would be measured until the user wraps the test object (04-REQ-67). */
  testObject: TestObjectBox | null;
}

/** The package config file the wizard writes. */
export const PERF_CONFIG_FILE = 'pw-perf.config.ts';

function manual(message: string, hint: string): CliIssue {
  return { code: 'INIT_MANUAL_STEP', message, hint };
}

function change(info: ProjectInfo, path: string, after: string): FileChange | null {
  const before = info.files.get(path) ?? null;
  if (before === after) return null;
  return { path, kind: before === null ? 'create' : 'modify', before, after };
}

const CONFIG_HINT = (t: Translate, path: string): string =>
  [
    t('configHintIntro'),
    `  import { withPerf } from '${PACKAGE_NAME}/config';`,
    `  import perfConfig from './pw-perf.config';`,
    `  export default withPerf(otherWrapper(defineConfig({ ... })), perfConfig);`,
    t('configHintCjs', { path, call: "withPerf(config, require('./pw-perf.config').default)" }),
  ].join('\n');

function planPerfConfig(
  info: ProjectInfo,
  answers: InitAnswers,
  plan: InitPlan,
  t: Translate,
): void {
  const existing = info.existing.perfConfig;
  if (existing === null || existing === PERF_CONFIG_FILE) {
    const c = change(info, PERF_CONFIG_FILE, renderPerfConfig(answers));
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

function planPlaywrightConfig(info: ProjectInfo, plan: InitPlan, t: Translate): void {
  const config = info.playwrightConfig;
  if (config === null || info.existing.wrappedConfig) return;
  const existing = info.existing.perfConfig;
  if (existing !== null && existing.endsWith('.json')) {
    plan.manualSteps.push(
      manual(
        t('manualConfigJson', { config: config.path, file: existing }),
        CONFIG_HINT(t, config.path).replaceAll("'./pw-perf.config'", `'./${existing}'`),
      ),
    );
    return;
  }
  const after = wrapPlaywrightConfig(config.text, './pw-perf.config');
  if (after === null) {
    plan.manualSteps.push(
      manual(t('manualConfigPattern', { config: config.path }), CONFIG_HINT(t, config.path)),
    );
    return;
  }
  plan.changes.push({ path: config.path, kind: 'modify', before: config.text, after });
}

/** A test call with a title at the start of a line: the file is a test file, not a module. */
const TEST_CALL =
  /^\s*(?:test|it)(?:\.(?:describe|only|skip|fixme|fail|serial|parallel|step)(?:\.\w+)?)?\s*\(\s*['"`]/mu;

function planTestObject(info: ProjectInfo, plan: InitPlan): void {
  if (info.existing.wrappedTest) return;
  const text = (path: string): string => info.files.get(path) ?? '';
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
    return;
  }
  plan.testObject = {
    extendFiles: [...new Set([...extendFiles, ...merges])].sort(),
    importingFiles: info.filesImportingPlaywrightTest.length,
  };
}

function planGitignore(info: ProjectInfo, plan: InitPlan): void {
  const dir = DEFAULT_CONFIG.report.dir;
  const current = info.files.get('.gitignore') ?? null;
  if (current !== null && ignores(current, dir)) return;
  const c = change(info, '.gitignore', addIgnore(current, dir));
  if (c !== null) plan.changes.push(c);
}

const INSTALL: Record<ProjectInfo['packageManager'], string> = {
  npm: 'npm ci',
  pnpm: 'pnpm install --frozen-lockfile',
  yarn: 'yarn install --immutable',
};

function planCi(info: ProjectInfo, answers: InitAnswers, plan: InitPlan, t: Translate): void {
  const platform = info.ciPlatform;
  if (!answers.addCi || platform === null) return;
  const file = ciFile(platform, testCommand(info.packageManager));
  const before = info.files.get(file.path) ?? null;
  if (before === file.text) return;
  if (before !== null) {
    plan.manualSteps.push(
      manual(t('manualCiKept', { file: file.path }), t('manualCiHint', { pkg: PACKAGE_NAME })),
    );
    return;
  }
  plan.changes.push({ path: file.path, kind: 'create', before: null, after: file.text });
  if (platform === 'gitlab' && !(info.files.get('.gitlab-ci.yml') ?? '').includes(file.path)) {
    plan.manualSteps.push(
      manual(t('manualGitlabInclude'), ['include:', `  - local: ${file.path}`].join('\n')),
    );
  }
  if (info.packageManager !== 'npm') {
    plan.manualSteps.push(
      manual(
        t('manualNpmOne', { files: file.path }),
        t('manualNpmHint', {
          manager: info.packageManager,
          install: INSTALL[info.packageManager],
          npx: info.packageManager === 'pnpm' ? 'pnpm exec' : 'yarn',
        }),
      ),
    );
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
  const plan: InitPlan = { changes: [], manualSteps: [], testObject: null };
  planPerfConfig(info, answers, plan, t);
  planPlaywrightConfig(info, plan, t);
  planTestObject(info, plan);
  planGitignore(info, plan);
  planCi(info, answers, plan, t);
  return plan;
}

/** Whether `path` is an existing package config, which needs its own confirmation (04-REQ-40). */
export function isProtected(info: ProjectInfo, path: string): boolean {
  return PERF_CONFIG_NAMES.includes(path) && info.existing.perfConfig === path;
}
