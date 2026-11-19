// The change plan of the init wizard (04-REQ-38 step 9, 04-REQ-39, 04-REQ-40, 04-REQ-42): file
// changes for recognized layouts, manual instructions (INIT_MANUAL_STEP) for everything else.
// Idempotent: a project that already has a change gets no second one. Pure.
import { DEFAULT_CONFIG } from '../../core/config/index.ts';
import { PACKAGE_NAME } from '../../core/types/index.ts';
import type { CliIssue } from '../../core/types/index.ts';
import { ciFiles, commandFlags } from './ci.ts';
import { EXTEND_CALL, PERF_CONFIG_NAMES } from './detect.ts';
import type { ProjectInfo } from './detect.ts';
import { renderPerfConfig } from './perf-config.ts';
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

const CONFIG_HINT = (path: string): string =>
  [
    `Wrap the exported config in withPerf() as the outermost call (also around other wrappers):`,
    `  import { withPerf } from '${PACKAGE_NAME}/config';`,
    `  import perfConfig from './pw-perf.config';`,
    `  export default withPerf(otherWrapper(defineConfig({ ... })), perfConfig);`,
    `In ${path} with module.exports: withPerf(config, require('./pw-perf.config').default).`,
  ].join('\n');

const TEST_HINT = [
  `Wrap every test object used by browser tests in withPerfFixtures() from '${PACKAGE_NAME}/fixture':`,
  '  export const test = withPerfFixtures(base.extend({ ... }));',
  '  export const adminTest = withPerfFixtures(test.extend({ ... }));',
  '  export const merged = withPerfFixtures(mergeTests(a, b));',
  'Wrap the result of mergeTests() and the test passed to createBdd() (playwright-bdd).',
  `Tests that import test from @playwright/test can import it from '${PACKAGE_NAME}/test' instead.`,
].join('\n');

function planPerfConfig(info: ProjectInfo, answers: InitAnswers, plan: InitPlan): void {
  const existing = info.existing.perfConfig;
  if (existing === null || existing === PERF_CONFIG_FILE) {
    const c = change(info, PERF_CONFIG_FILE, renderPerfConfig(answers));
    if (c !== null) plan.changes.push(c);
    return;
  }
  // Another format: never rewritten; the answers are listed for the user to copy (04-REQ-40).
  const values = [
    ...Object.entries(answers.originLabels).map(([o, l]) => `keys.origins["${o}"] = "${l}"`),
    ...(answers.repeatTest === DEFAULT_CONFIG.run.repeat.test
      ? []
      : [`run.repeat.test = ${answers.repeatTest}`]),
    ...(answers.warnOnly === DEFAULT_CONFIG.gate.warnOnly
      ? []
      : [`gate.warnOnly = ${answers.warnOnly}`]),
  ];
  if (values.length > 0) {
    plan.manualSteps.push(
      manual(
        `${existing} exists and was not changed.`,
        `Set these options in it if you want them:\n${values.map((v) => `  ${v}`).join('\n')}`,
      ),
    );
  }
}

function planPlaywrightConfig(info: ProjectInfo, plan: InitPlan): void {
  const config = info.playwrightConfig;
  if (config === null || info.existing.wrappedConfig) return;
  const existing = info.existing.perfConfig;
  if (existing !== null && existing.endsWith('.json')) {
    plan.manualSteps.push(
      manual(
        `${config.path} was not changed: the package config is ${existing}.`,
        CONFIG_HINT(config.path).replaceAll("'./pw-perf.config'", `'./${existing}'`),
      ),
    );
    return;
  }
  const after = wrapPlaywrightConfig(config.text, './pw-perf.config');
  if (after === null) {
    plan.manualSteps.push(
      manual(
        `${config.path} was not changed: its export is not a plain defineConfig({...}) or object (for example another wrapper).`,
        CONFIG_HINT(config.path),
      ),
    );
    return;
  }
  plan.changes.push({ path: config.path, kind: 'modify', before: config.text, after });
}

function planTestObject(info: ProjectInfo, plan: InitPlan): void {
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
      plan.manualSteps.push(
        manual(
          'No test object was found to measure: no file imports test from @playwright/test.',
          TEST_HINT,
        ),
      );
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
        `${files.join(', ')} ${files.length === 1 ? 'was' : 'were'} not changed: the test objects are not one \`export const test = base.extend(...)\` (several test objects, mergeTests() or another layout).`,
        TEST_HINT,
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

function planScripts(info: ProjectInfo, answers: InitAnswers, plan: InitPlan): void {
  const text = info.files.get('package.json');
  const wanted = plannedScripts(answers);
  if (text === undefined) {
    plan.manualSteps.push(
      manual(
        'package.json was not found.',
        `Add these scripts:\n${Object.entries(wanted)
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
        manual(
          `package.json: the script "${name}" exists and was not changed.`,
          `The wizard would add "${name}": "${command}". Rename one of them, or add the command by hand.`,
        ),
      );
    }
  }
  if (Object.keys(added).length === 0) return;
  const after = addScripts(text, added);
  if (after === null) {
    plan.manualSteps.push(
      manual(
        'package.json was not changed: it is not a JSON object with a "scripts" object.',
        `Add these scripts:\n${Object.entries(added)
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

function planCi(info: ProjectInfo, answers: InitAnswers, plan: InitPlan): void {
  const platform = info.ciPlatform;
  if (!answers.addCi || platform === null) return;
  const created: string[] = [];
  for (const file of ciFiles(platform, answers.scope, answers.envLabels)) {
    const before = info.files.get(file.path) ?? null;
    if (before === file.text) continue;
    if (before !== null) {
      plan.manualSteps.push(
        manual(
          `${file.path} exists and was not changed.`,
          `Compare it with examples/ci/ in the ${PACKAGE_NAME} repository.`,
        ),
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
          '.gitlab-ci.yml was not changed: include the new job file in it.',
          ['include:', ...missing.map((p) => `  - local: ${p}`)].join('\n'),
        ),
      );
    }
  }
  if (created.length > 0 && info.packageManager !== 'npm') {
    plan.manualSteps.push(
      manual(
        `${created.join(', ')} ${created.length === 1 ? 'installs' : 'install'} the dependencies with npm.`,
        `This project uses ${info.packageManager}: replace "npm ci" with "${INSTALL[info.packageManager]}" and "npx" with "${info.packageManager === 'pnpm' ? 'pnpm exec' : 'yarn'}".`,
      ),
    );
  }
}

/** Pure plan of the init changes; unrecognized layouts give manual steps (04-REQ-39). */
export function planInitChanges(info: ProjectInfo, answers: InitAnswers): InitPlan {
  const plan: InitPlan = { changes: [], manualSteps: [] };
  planPerfConfig(info, answers, plan);
  planPlaywrightConfig(info, plan);
  planTestObject(info, plan);
  planGitignore(info, plan);
  planScripts(info, answers, plan);
  planCi(info, answers, plan);
  return plan;
}

/** Whether `path` is an existing package config, which needs its own confirmation (04-REQ-40). */
export function isProtected(info: ProjectInfo, path: string): boolean {
  return PERF_CONFIG_NAMES.includes(path) && info.existing.perfConfig === path;
}
