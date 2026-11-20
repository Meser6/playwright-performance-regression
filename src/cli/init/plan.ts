// The change plan of the init wizard (04-REQ-38 step 9, 04-REQ-39, 04-REQ-40, 04-REQ-42): file
// changes for recognized layouts, manual instructions (INIT_MANUAL_STEP) for everything else.
// Idempotent: a project that already has a change gets no second one. Pure.
import { DEFAULT_CONFIG } from '../../core/config/index.ts';
import { PACKAGE_NAME } from '../../core/types/index.ts';
import type { CliIssue } from '../../core/types/index.ts';
import { ciFiles, commandFlags } from './ci.ts';
import { EXTEND_CALL, PERF_CONFIG_NAMES } from './detect.ts';
import type { ProjectInfo } from './detect.ts';
import { translator } from './messages.ts';
import type { Translate, WizardLanguage } from './messages.ts';
import { activeValues, renderPerfConfig, ts } from './perf-config.ts';
import type { InitAnswers } from './perf-config.ts';
import {
  addIgnore,
  addScripts,
  ignores,
  swapTestImport,
  wrapPlaywrightConfig,
  wrapTestObject,
} from './patterns.ts';

export interface FileChange {
  path: string;
  kind: 'create' | 'modify';
  before: string | null;
  after: string;
}

export interface InitPlan {
  changes: FileChange[];
  manualSteps: CliIssue[];
}

/** The package config file the wizard writes. */
export const PERF_CONFIG_FILE = 'pw-perf.config.ts';

/** The npm scripts for the answers (04-REQ-42). */
export function plannedScripts(
  answers: Pick<InitAnswers, 'scope' | 'envLabels'>,
): Record<string, string> {
  const labels: (string | null)[] = answers.envLabels.length === 0 ? [null] : answers.envLabels;
  const scripts: Record<string, string> = {};
  for (const label of labels) {
    const name = label === null ? '' : `:${label}`;
    const flags = commandFlags(answers.scope, label);
    scripts[`perf:test${name}`] = `pw-perf test${flags}`;
    scripts[`perf:thresholds${name}`] = `pw-perf thresholds${flags}`;
  }
  return scripts;
}

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

const TEST_HINT = (t: Translate): string =>
  [
    t('testHintIntro', { entry: `${PACKAGE_NAME}/fixture` }),
    '  export const test = withPerfFixtures(base.extend({ ... }));',
    '  export const adminTest = withPerfFixtures(test.extend({ ... }));',
    '  export const merged = withPerfFixtures(mergeTests(a, b));',
    t('testHintMerge'),
    t('testHintImport', { entry: `${PACKAGE_NAME}/test` }),
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

function planTestObject(info: ProjectInfo, plan: InitPlan, t: Translate): void {
  if (info.existing.wrappedTest) return;
  const text = (path: string): string => info.files.get(path) ?? '';
  const extendFiles = info.filesWithExtend;
  const merges = [...info.files.keys()].filter(
    (p) => info.filesImportingPlaywrightTest.includes(p) && /\bmergeTests\s*\(/u.test(text(p)),
  );
  if (extendFiles.length === 0 && merges.length === 0) {
    const swaps = info.filesImportingPlaywrightTest.flatMap((path) => {
      const after = swapTestImport(text(path));
      return after === null ? [] : [{ path, kind: 'modify' as const, before: text(path), after }];
    });
    if (swaps.length === 0) {
      plan.manualSteps.push(manual(t('manualNoTestObject'), TEST_HINT(t)));
    }
    plan.changes.push(...swaps);
    return;
  }
  const only = extendFiles.length === 1 && merges.length === 0 ? (extendFiles[0] as string) : null;
  const after =
    only !== null && [...text(only).matchAll(EXTEND_CALL)].length === 1
      ? wrapTestObject(text(only))
      : null;
  if (only === null || after === null) {
    const files = [...new Set([...extendFiles, ...merges])].sort();
    plan.manualSteps.push(
      manual(
        `${t(files.length === 1 ? 'manualTestObjectOne' : 'manualTestObjectMany', {
          files: files.join(', '),
        })} ${t('testObjectsReason')}`,
        TEST_HINT(t),
      ),
    );
    return;
  }
  plan.changes.push({ path: only, kind: 'modify', before: text(only), after });
}

function planGitignore(info: ProjectInfo, plan: InitPlan): void {
  const dir = DEFAULT_CONFIG.report.dir;
  const current = info.files.get('.gitignore') ?? null;
  if (current !== null && ignores(current, dir)) return;
  const c = change(info, '.gitignore', addIgnore(current, dir));
  if (c !== null) plan.changes.push(c);
}

function planScripts(info: ProjectInfo, answers: InitAnswers, plan: InitPlan, t: Translate): void {
  const text = info.files.get('package.json');
  const wanted = plannedScripts(answers);
  if (text === undefined) {
    plan.manualSteps.push(
      manual(
        t('manualNoPackageJson'),
        `${t('addScripts')}\n${Object.entries(wanted)
          .map(([k, v]) => `  "${k}": "${v}"`)
          .join('\n')}`,
      ),
    );
    return;
  }
  let current: Record<string, unknown> = {};
  try {
    const scripts = (JSON.parse(text) as { scripts?: unknown }).scripts;
    if (typeof scripts === 'object' && scripts !== null)
      current = scripts as Record<string, unknown>;
  } catch {
    // addScripts reports the file below.
  }
  const added: Record<string, string> = {};
  for (const [name, command] of Object.entries(wanted)) {
    if (current[name] === undefined) added[name] = command;
    else if (current[name] !== command) {
      plan.manualSteps.push(
        manual(t('manualScriptExists', { name }), t('manualScriptHint', { name, command })),
      );
    }
  }
  if (Object.keys(added).length === 0) return;
  const after = addScripts(text, added);
  if (after === null) {
    plan.manualSteps.push(
      manual(
        t('manualPackageJsonInvalid'),
        `${t('addScripts')}\n${Object.entries(added)
          .map(([k, v]) => `  "${k}": "${v}"`)
          .join('\n')}`,
      ),
    );
    return;
  }
  plan.changes.push({ path: 'package.json', kind: 'modify', before: text, after });
}

const INSTALL: Record<ProjectInfo['packageManager'], string> = {
  npm: 'npm ci',
  pnpm: 'pnpm install --frozen-lockfile',
  yarn: 'yarn install --immutable',
};

function planCi(info: ProjectInfo, answers: InitAnswers, plan: InitPlan, t: Translate): void {
  const platform = info.ciPlatform;
  if (!answers.addCi || platform === null) return;
  const created: string[] = [];
  for (const file of ciFiles(platform, answers.scope, answers.envLabels)) {
    const before = info.files.get(file.path) ?? null;
    if (before === file.text) continue;
    if (before !== null) {
      plan.manualSteps.push(
        manual(t('manualCiKept', { file: file.path }), t('manualCiHint', { pkg: PACKAGE_NAME })),
      );
      continue;
    }
    plan.changes.push({ path: file.path, kind: 'create', before: null, after: file.text });
    created.push(file.path);
  }
  if (platform === 'gitlab') {
    const main = info.files.get('.gitlab-ci.yml') ?? '';
    const missing = ciFiles(platform, answers.scope, answers.envLabels)
      .map((f) => f.path)
      .filter((p) => !main.includes(p));
    if (missing.length > 0) {
      plan.manualSteps.push(
        manual(
          t('manualGitlabInclude'),
          ['include:', ...missing.map((p) => `  - local: ${p}`)].join('\n'),
        ),
      );
    }
  }
  if (created.length > 0 && info.packageManager !== 'npm') {
    plan.manualSteps.push(
      manual(
        t(created.length === 1 ? 'manualNpmOne' : 'manualNpmMany', { files: created.join(', ') }),
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
  const plan: InitPlan = { changes: [], manualSteps: [] };
  planPerfConfig(info, answers, plan, t);
  planPlaywrightConfig(info, plan, t);
  planTestObject(info, plan, t);
  planGitignore(info, plan);
  planScripts(info, answers, plan, t);
  planCi(info, answers, plan, t);
  return plan;
}

/** Whether `path` is an existing package config, which needs its own confirmation (04-REQ-40). */
export function isProtected(info: ProjectInfo, path: string): boolean {
  return PERF_CONFIG_NAMES.includes(path) && info.existing.perfConfig === path;
}
