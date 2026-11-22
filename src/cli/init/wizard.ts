// The init wizard (04, chapter 4.10): the tutorial question (0a), the language (0) and eleven
// steps, each with a short lesson. Origin labels and environments are not asked (07-REQ-03,
// note #26). Interactive only when stdin and stdout are terminals; without a terminal it takes
// the default answers and only shows the plan, like PW_PERF_DRY_RUN=1 (04-REQ-37, 04-D-20, 04-D-38).
// Declining the tutorial (or PW_PERF_NO_TUTORIAL=1) prints
// the manual setup and changes nothing (04-REQ-45). Texts in the chosen language (04-REQ-43),
// colors by 04-REQ-44. Nothing is written before the changes step (04-REQ-41).
import { asciiTerminal, box as renderBox } from '../../console/box.ts';
import type { BoxLine } from '../../console/box.ts';
import { colorEnabled, painter } from '../../console/color.ts';
import type { ColorStyle, Painter } from '../../console/color.ts';
import { DEFAULT_CONFIG, MARGIN_PRESETS, resolveConfig } from '../../core/config/index.ts';
import type { MarginPreset } from '../../core/config/index.ts';
import { INIT_COMMAND, PACKAGE_NAME, REPOSITORY_URL } from '../../core/types/index.ts';
import type { CliIssue } from '../../core/types/index.ts';
import { parsePasses } from '../../mode/index.ts';
import type { CliHost, Prompt } from '../host.ts';
import { formatIssues, infoLine } from '../output.ts';
import type { OutputStyle } from '../output.ts';
import { CI_PATHS } from './ci.ts';
import { DEFAULT_ANSWERS_PASSES } from './defaults.ts';
import { detectProject } from './detect.ts';
import type { CiPlatform, ProjectInfo } from './detect.ts';
import { unifiedDiff } from './diff.ts';
import { readProjectFiles } from './files.ts';
import { LANGUAGES, LANGUAGE_NAMES, isWizardLanguage, translator } from './messages.ts';
import type { MessageKey, MessageValues, Translate, WizardLanguage } from './messages.ts';
import type { InitAnswers } from './perf-config.ts';
import { isProtected, planInitChanges } from './plan.ts';
import type { FileChange, TestObjectBox } from './plan.ts';
import { PromptAborted } from './prompt.ts';
import { breakingFlags, commandSpawn, defaultScript, runCommands } from './scripts.ts';
import type { DetectedScript, FlagEffect, RunCommands } from './scripts.ts';

/** The wizard settings from PW_PERF_DRY_RUN, PW_PERF_LANG and PW_PERF_NO_TUTORIAL (D-43). */
export interface InitCommand {
  dryRun: boolean;
  lang?: WizardLanguage;
  noTutorial?: boolean;
}

/** "1.57.0" ≥ "1.57.0"; pre-release parts are ignored. */
export function versionAtLeast(version: string, minimum: string): boolean {
  const parts = (v: string): number[] =>
    v
      .split(/[.+-]/u)
      .slice(0, 3)
      .map((p) => Number.parseInt(p, 10) || 0);
  const a = parts(version);
  const b = parts(minimum);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

/** Steps shown as [n/11] (04-REQ-38); skipped steps keep their number. */
const STEPS = 11;
const PLATFORM_NAMES: Record<CiPlatform, string> = {
  github: 'GitHub Actions',
  gitlab: 'GitLab CI',
  jenkins: 'Jenkins',
  azure: 'Azure Pipelines',
};
const DOCS = `${REPOSITORY_URL}/blob/main/docs`;
/** Step 0a and step 0 come before the language is known: English (04-REQ-45, 04-REQ-43). */
const TUTORIAL_QUESTION = `Set up ${PACKAGE_NAME} with a guided tutorial?`;
const LANGUAGE_QUESTION = `Language / Język? [${LANGUAGES.join('/')}]`;

/** Warning code of the red box (04-REQ-67). */
const TEST_OBJECT_CODE = 'INIT_TEST_OBJECT_MANUAL';

class WriteFailed extends Error {}

/** Asks questions in a terminal, or prints the default answer without one. */
class Dialog {
  readonly #host: CliHost;
  readonly #prompt: Prompt | null;
  readonly #style: OutputStyle;
  /** Colors of stdout (04-REQ-44). */
  readonly paint: Painter;
  readonly colors: boolean;
  /** TERM=dumb: ASCII frames. */
  readonly ascii: boolean;
  t: Translate = translator('en');

  constructor(host: CliHost, prompt: Prompt | null, style: OutputStyle) {
    this.#host = host;
    this.#prompt = prompt;
    this.#style = style;
    this.colors = colorEnabled(host.stdout, host.env);
    this.paint = painter(this.colors);
    this.ascii = asciiTerminal(host.env);
  }

  get interactive(): boolean {
    return this.#prompt !== null;
  }

  say(...lines: string[]): void {
    this.#host.stdout.write(lines.map((l) => `${l}\n`).join(''));
  }

  /** An indented line in one color. */
  line(text: string, style: ColorStyle, indent = '  '): void {
    this.say(`${indent}${this.paint(text, style)}`);
  }

  /** Step header in cyan ("[3/10] Which tests") and the lesson dimmed. */
  step(n: number | string, title: string, ...lesson: string[]): void {
    this.say('', this.paint(`[${n}/${STEPS}] ${title}`, 'cyan'));
    for (const l of lesson) this.line(l, 'dim');
  }

  stepOf(n: number, title: MessageKey, ...lesson: MessageKey[]): void {
    this.step(n, this.t(title), ...lesson.map((k) => this.t(k)));
  }

  warn(issues: readonly CliIssue[]): void {
    if (issues.length > 0) this.#host.stderr.write(formatIssues(issues, 'warning', this.#style));
  }

  error(code: string, message: MessageKey, hint: MessageKey, values: MessageValues): number {
    this.#host.stderr.write(
      formatIssues(
        [{ code, message: this.t(message, values), hint: this.t(hint, values) }],
        'error',
        this.#style,
      ),
    );
    return 3;
  }

  /** A question with a default; `parse` returns the value or null to ask again. */
  async ask<T>(
    question: string,
    shownDefault: string,
    fallback: T,
    parse: (answer: string) => T | null,
    fallbackText = shownDefault,
  ): Promise<T> {
    const text = `  ${this.paint(question, 'bold')} ${this.paint(`(${shownDefault})`, 'dim')} `;
    if (this.#prompt === null) {
      this.say(`${text}→ ${this.paint(fallbackText, 'bold')}`);
      return fallback;
    }
    for (;;) {
      const answer = (await this.#prompt.ask(text)).trim();
      if (answer === '') return fallback;
      const value = parse(answer);
      if (value !== null) return value;
      this.line(`⚠ ${this.t('answerAgain')}`, 'yellow');
    }
  }

  confirm(question: string, fallback: boolean): Promise<boolean> {
    const t = this.t;
    const y = t('yesShort');
    const n = t('noShort');
    const yes = new Set(['y', 'yes', y, t('yes')]);
    const no = new Set(['n', 'no', n, t('no')]);
    return this.ask(
      question,
      fallback ? `${y.toUpperCase()}/${n}` : `${y}/${n.toUpperCase()}`,
      fallback,
      (a) => {
        const answer = a.toLowerCase();
        return yes.has(answer) ? true : no.has(answer) ? false : null;
      },
      fallback ? t('yes') : t('no'),
    );
  }

  async pause(): Promise<void> {
    if (this.#prompt !== null)
      await this.#prompt.ask(`  ${this.paint(this.t('pressEnter'), 'dim')} `);
  }
}

function describeProject(info: ProjectInfo, t: Translate): string[] {
  const config = info.playwrightConfig;
  const lines = [
    t('projectLine', {
      config: config?.path ?? '-',
      version: info.playwrightVersion ?? t('versionUnknown'),
      manager: info.packageManager,
      modules: info.moduleType === 'esm' ? 'ES modules' : 'CommonJS',
    }),
    t('testDirLine', {
      dir: info.testDir,
      imports: info.filesImportingPlaywrightTest.length,
      extend: info.filesWithExtend.length,
    }),
  ];
  if (info.baseUrls.length > 0 || info.projectNames.length > 0) {
    lines.push(
      [
        info.baseUrls.length > 0 ? `baseURL ${info.baseUrls.join(', ')}` : null,
        info.projectNames.length > 0
          ? t('projectsPart', { names: info.projectNames.join(', ') })
          : null,
      ]
        .filter((part) => part !== null)
        .join(' · '),
    );
  }
  lines.push(
    t('ciLine', {
      platform: info.ciPlatform === null ? t('ciNone') : PLATFORM_NAMES[info.ciPlatform],
    }),
  );
  if (
    info.existing.wrappedConfig ||
    info.existing.wrappedTest ||
    info.existing.perfConfig !== null
  ) {
    lines.push(
      t('alreadySetUp', {
        items: [
          info.existing.wrappedConfig ? 'withPerf()' : null,
          info.existing.wrappedTest ? t('measuredTestObject') : null,
          info.existing.perfConfig,
        ]
          .filter((part) => part !== null)
          .join(', '),
      }),
    );
  }
  return lines;
}

/** Step 0a declined or PW_PERF_NO_TUTORIAL=1: the manual setup, no changes (04-REQ-45). */
function printManualSetup(dialog: Dialog): void {
  const { t, paint } = dialog;
  const cmd = (text: string): string => paint(text, 'cyan');
  dialog.say('');
  dialog.line(`✔ ${t('declinedInstalled', { pkg: PACKAGE_NAME })}`, 'green');
  dialog.say(
    `  ${paint(t('declinedSteps'), 'bold')}`,
    `    1. ${t('declinedConfig', { config: `${PACKAGE_NAME}/config` })}`,
    `    2. ${t('declinedTest', { fixture: `${PACKAGE_NAME}/fixture`, test: `${PACKAGE_NAME}/test` })}`,
    `    3. ${t('declinedRun', { example: cmd('PW_PERF_MODE=test npx playwright test') })}`,
  );
  dialog.line(t('declinedDocs', { url: `${DOCS}/adoption.md` }), 'dim');
  dialog.say(`  ${t('declinedLater', { init: cmd(INIT_COMMAND) })}`);
}

/** Step 0: the language from PW_PERF_LANG, the answer in a terminal, or English (04-REQ-43). */
async function askLanguage(
  dialog: Dialog,
  given: WizardLanguage | undefined,
): Promise<WizardLanguage> {
  dialog.step(0, 'Language');
  dialog.line(LANGUAGES.map((l) => `${l} ${LANGUAGE_NAMES[l]}`).join(' · '), 'dim');
  if (given !== undefined) {
    dialog.say(
      `  ${dialog.paint(LANGUAGE_QUESTION, 'bold')} ${dialog.paint('(en)', 'dim')} → ${dialog.paint(given, 'bold')}`,
    );
    return given;
  }
  return dialog.ask<WizardLanguage>(LANGUAGE_QUESTION, 'en', 'en', (a) => {
    const code = a.toLowerCase();
    if (isWizardLanguage(code)) return code;
    return LANGUAGES.find((l) => LANGUAGE_NAMES[l].toLowerCase() === code) ?? null;
  });
}

/** Numbers separated by commas (1-based) → indexes, or null when one is out of range. */
function parseNumbers(answer: string, count: number): number[] | null {
  const parts = answer
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '');
  if (parts.length === 0) return null;
  const indexes = parts.map((p) => (/^\d+$/u.test(p) ? Number(p) - 1 : -1));
  if (indexes.some((i) => i < 0 || i >= count)) return null;
  return [...new Set(indexes)].sort((a, b) => a - b);
}

/** Step 2 (04-REQ-54, 04-REQ-56): the test script and its warnings. */
async function askScript(dialog: Dialog, info: ProjectInfo): Promise<DetectedScript | null> {
  const { t, paint } = dialog;
  const scripts = info.testScripts;
  if (scripts.length === 0) return null;
  dialog.step(2, t('stepScript'), t('scriptLesson'));
  const options = [...scripts.map((s) => s.name), null];
  options.forEach((name, i) => {
    const script = scripts[i];
    const text = script === undefined ? '' : paint(` ${shorten(script.text, 70)}`, 'dim');
    dialog.say(`    ${i + 1}. ${name ?? t('scriptPlain')}${text}`);
  });
  const fallback = defaultScript(scripts);
  const fallbackIndex = options.indexOf(fallback);
  const index = await dialog.ask(
    t('scriptQuestion', { count: options.length }),
    String(fallbackIndex + 1),
    fallbackIndex,
    (a) => parseNumbers(a, options.length)?.[0] ?? null,
    `${fallbackIndex + 1}. ${fallback ?? t('scriptPlain')}`,
  );
  const chosen = scripts[index] ?? null;
  if (chosen === null) return null;
  const flags = breakingFlags(chosen);
  if (flags.length > 0) {
    dialog.warn([
      {
        code: 'INIT_SCRIPT_FLAG',
        message: t('scriptFlagMessage', {
          name: chosen.name,
          flags: flags.map((f) => `${f.flag} (${t(FLAG_EFFECT_KEYS[f.effect])})`).join('; '),
        }),
        hint: t('scriptFlagHint', { name: chosen.name }),
      },
    ]);
  }
  if (chosen.laterSegments.length > 0) {
    dialog.warn([
      {
        code: 'INIT_SCRIPT_LATER_STEPS',
        message: t('laterStepsMessage', {
          name: chosen.name,
          steps: chosen.laterSegments.join(' && '),
        }),
        hint: t('laterStepsHint'),
      },
    ]);
  }
  return chosen;
}

const FLAG_EFFECT_KEYS: Readonly<Record<FlagEffect, MessageKey>> = {
  interactive: 'flagInteractive',
  sharded: 'flagSharded',
  reporter: 'flagReporter',
  changingTests: 'flagChangingTests',
  conditions: 'flagConditions',
};

function shorten(text: string, width: number): string {
  const chars = Array.from(text);
  return chars.length <= width ? text : `${chars.slice(0, width - 1).join('')}…`;
}

async function askAnswers(dialog: Dialog, info: ProjectInfo): Promise<InitAnswers> {
  const { t } = dialog;
  const script = await askScript(dialog, info);

  let scope: 'all' | 'tagged' = 'all';
  if (script?.selectsTests === true) {
    dialog.step(4, t('stepTests'), t('scriptSelectsTests'));
  } else {
    dialog.step(
      4,
      t('stepTests'),
      t('testsLesson'),
      t('taggedFiles', { count: info.taggedPerfTestFiles }),
    );
    if (info.taggedPerfTestFiles === 0) {
      // Information only: the default is all tests either way.
      const code = 'INIT_NO_TAGGED_TESTS';
      dialog.say(`  ${dialog.paint(`ℹ ${code}`, 'cyan')} ${t('noTaggedMessage')}`);
      dialog.line(t('noTaggedHint'), 'dim', '    ');
    }
    const all = t('scopeAll');
    scope = await dialog.ask<'all' | 'tagged'>(t('scopeQuestion', { all }), all, 'all', (a) => {
      const answer = a.toLowerCase();
      if (answer === 'all' || answer === all) return 'all';
      return answer === '@perf' || answer === 'perf' ? 'tagged' : null;
    });
    if (scope === 'tagged') dialog.line(t('taggedSaved'), 'dim');
  }

  dialog.stepOf(5, 'stepPasses', 'passesLesson');
  const passesTest = await dialog.ask(
    t('passesQuestion'),
    String(DEFAULT_ANSWERS_PASSES),
    DEFAULT_ANSWERS_PASSES,
    (a) => {
      const n = parsePasses(a);
      return n !== null && resolveConfig({ run: { passes: { test: n } } }, {}).ok ? n : null;
    },
  );

  // Step 6 only when the project has test.step calls (04-REQ-47); otherwise the default (on).
  let steps = DEFAULT_CONFIG.measure.steps;
  if (info.stepFiles > 0) {
    dialog.step(6, t('stepSteps'), t('stepsLesson'), t('stepsPrivacy'));
    steps = await dialog.confirm(t('stepsQuestion', { count: info.stepFiles }), true);
  }

  dialog.stepOf(7, 'stepPreset', 'presetLesson', 'presetStrict', 'presetNormal', 'presetLoose');
  const normal = DEFAULT_CONFIG.thresholds.preset;
  const preset = await dialog.ask<MarginPreset>(t('presetQuestion'), normal, normal, (a) => {
    const answer = a.toLowerCase() as MarginPreset;
    return MARGIN_PRESETS.includes(answer) ? answer : null;
  });

  dialog.stepOf(8, 'stepCi', 'ci1', 'ci2', 'ci3', 'ci4');
  let addCi = false;
  if (info.ciPlatform === null) {
    dialog.say(`  ${t('noCi', { url: `${DOCS}/ci.md` })}`);
  } else {
    addCi = await dialog.confirm(
      t('ciQuestion', { platform: PLATFORM_NAMES[info.ciPlatform] }),
      true,
    );
  }
  return {
    script: script?.name ?? null,
    scope,
    passesTest,
    steps,
    preset,
    addCi,
    runCheck: false,
  };
}

/** Words of `text` in lines of at most `width` characters. */
function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line !== '' && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line === '' ? word : `${line} ${word}`;
  }
  if (line !== '') lines.push(line);
  return lines;
}

/** The red box of 04-REQ-67: what to paste so that the tests are measured. */
function testObjectBox(dialog: Dialog, host: CliHost, box: TestObjectBox): string {
  const { t } = dialog;
  const width = Math.min(100, Math.max(40, host.stdout.columns ?? 100));
  const inner = width - 4;
  const text = (s: string, style?: ColorStyle): BoxLine[] =>
    wrapText(s, inner).map((l) => (style === undefined ? { text: l } : { text: l, style }));
  const lines: BoxLine[] = [
    {
      text: `${dialog.ascii ? '!' : '✖'} ${TEST_OBJECT_CODE} · ${t('boxTitle')}`,
      style: 'bold',
    },
    { text: '' },
    ...text(t('boxWhy')),
    { text: '' },
    ...text(`(a) ${t('boxFixtures')}`, 'bold'),
    ...(box.extendFiles.length > 0
      ? text(t('boxFixturesFiles', { files: box.extendFiles.join(', ') }), 'dim')
      : []),
    { text: `    import { withPerfFixtures } from '${PACKAGE_NAME}/fixture';`, style: 'cyan' },
    { text: '    export const test = withPerfFixtures(base.extend({ ... }));', style: 'cyan' },
    { text: '' },
    ...text(`(b) ${t('boxImports', { count: box.importingFiles })}`, 'bold'),
    { text: `    import { test, expect } from '${PACKAGE_NAME}/test';`, style: 'cyan' },
    { text: '' },
    ...text(t('boxDocs', { url: `${DOCS}/adoption.md` }), 'dim'),
  ];
  return renderBox(lines, { width, color: dialog.colors, ascii: dialog.ascii, border: 'red' });
}

function changeKind(change: FileChange, t: Translate): string {
  return change.kind === 'create' ? t('newFile') : t('modifiedFile');
}

/** Diff lines: added green, removed red, hunk headers cyan, file headers bold (04-REQ-44). */
function diffStyle(line: string): ColorStyle | null {
  if (line.startsWith('+++') || line.startsWith('---')) return 'bold';
  if (line.startsWith('+')) return 'green';
  if (line.startsWith('-')) return 'red';
  if (line.startsWith('@@')) return 'cyan';
  return null;
}

/** The changes step: diffs, confirmations and writes. Returns the paths written. */
async function applyChanges(
  dialog: Dialog,
  host: CliHost,
  info: ProjectInfo,
  changes: readonly FileChange[],
  write: boolean,
): Promise<string[]> {
  const { t, paint } = dialog;
  const written: string[] = [];
  for (const change of changes) {
    dialog.say(
      '',
      `  ${paint(change.path, 'bold')} ${paint(`(${changeKind(change, t)})`, 'dim')}`,
      ...unifiedDiff(change)
        .trimEnd()
        .split('\n')
        .map((l) => {
          const style = diffStyle(l);
          return `    ${style === null ? l : paint(l, style)}`;
        }),
    );
    let apply: boolean;
    if (isProtected(info, change.path)) {
      // Never overwritten without its own confirmation (04-REQ-40).
      if (dialog.interactive)
        apply = await dialog.confirm(t('overwriteQuestion', { path: change.path }), false);
      else {
        dialog.say(`  ${t('kept', { path: change.path })}`);
        apply = false;
      }
    } else {
      apply = await dialog.confirm(t('applyQuestion'), true);
    }
    if (!apply || !write) continue;
    try {
      await host.writeText(host.paths.join(host.cwd, change.path), change.after);
    } catch (error) {
      throw new WriteFailed(
        `${change.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    dialog.line(`✔ ${t('fileWritten', { path: change.path })}`, 'green');
    written.push(change.path);
  }
  return written;
}

/**
 * Names of the thresholds files the runs will write (04-REQ-59 step 3): the step file only when
 * steps are measured and the project has test.step calls.
 */
function thresholdsFiles(info: ProjectInfo, answers: InitAnswers): string[] {
  const prefix = DEFAULT_CONFIG.thresholds.filePrefix;
  return answers.steps && info.stepFiles > 0
    ? [`${prefix}.json`, `${prefix}.steps.json`]
    : [`${prefix}.json`];
}

/** Next steps of the summary (04-REQ-59). */
function nextSteps(
  dialog: Dialog,
  info: ProjectInfo,
  answers: InitAnswers,
  commands: RunCommands,
  written: readonly string[],
  checkRan: boolean,
): string[] {
  const { t, paint } = dialog;
  const cmd = (text: string): string => paint(text, 'cyan');
  if (written.length === 0) return [t('nextApply')];
  const dir = DEFAULT_CONFIG.report.dir;
  const platform = info.ciPlatform;
  const ciPath = answers.addCi && platform !== null ? CI_PATHS[platform] : null;
  const estimate = t(checkRan ? 'estimateAbove' : 'estimateUnknown');
  const steps: string[] = [];
  if (!checkRan) steps.push(t('nextCheck', { command: cmd(commands.check) }));
  steps.push(
    ciPath === null
      ? t('nextThresholdsNoCi', {
          command: cmd(commands.thresholds),
          url: `${DOCS}/ci.md`,
          estimate,
        })
      : t('nextThresholds', { command: cmd(commands.thresholds), estimate }),
    t('nextCommit', { files: thresholdsFiles(info, answers).join(', ') }),
    t('nextTest', {
      command: cmd(commands.test),
      report: `${dir}/report.html`,
      outcome: `${dir}/outcome.json`,
    }),
  );
  if (ciPath !== null && platform !== null) {
    const ci = [t('nextCiJobs', { path: ciPath })];
    if (platform === 'jenkins') ci.push(t('nextJenkins', { path: ciPath }));
    if (platform === 'azure') ci.push(t('nextAzure', { path: ciPath }));
    steps.push(ci.join(' '));
  }
  return steps;
}

/** Step 10 (04-REQ-58): runs the check command as a child process with the terminal. */
async function runCheck(
  dialog: Dialog,
  host: CliHost,
  info: ProjectInfo,
  answers: InitAnswers,
  commands: RunCommands,
): Promise<number | null> {
  const spec = commandSpawn({
    script: answers.script,
    packageManager: info.packageManager,
    npmExecPath: host.env.npm_execpath,
    nodePath: host.execPath,
    playwrightCli: host.resolvePlaywright(host.cwd)?.cliPath ?? null,
    platform: host.platform,
  });
  if (!spec.ok) {
    dialog.line(dialog.t('checkManual', { command: commands.check }), 'yellow');
    return null;
  }
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(host.env)) if (value !== undefined) env[name] = value;
  env.PW_PERF_MODE = 'check';
  dialog.line(`$ ${commands.check}`, 'dim');
  // Ctrl+C goes to the whole process group: the check stops and the wizard reports 130.
  const stop = host.onSignal('SIGINT', () => undefined);
  try {
    const child = host.spawnProcess(spec.value.file, spec.value.args, {
      cwd: host.cwd,
      env,
      stdio: 'inherit',
      shell: spec.value.shell,
    });
    return await new Promise<number>((resolve) => {
      child.once('exit', (code, signal) => resolve(signal === 'SIGINT' ? 130 : (code ?? 1)));
      child.once('error', () => resolve(1));
    });
  } finally {
    stop();
  }
}

export async function runInit(
  cmd: InitCommand,
  host: CliHost,
  style: OutputStyle,
): Promise<number> {
  const interactive = !cmd.dryRun && host.stdin.isTTY === true && host.stdout.isTTY === true;
  const write = interactive;
  const prompt = interactive && cmd.noTutorial !== true ? host.createPrompt() : null;
  const dialog = new Dialog(host, prompt, style);
  try {
    // Step 0a: without a terminal the question is skipped (04-REQ-45).
    if (cmd.noTutorial === true) {
      dialog.t = translator(cmd.lang ?? 'en');
      printManualSetup(dialog);
      return 0;
    }
    if (interactive && !(await dialog.confirm(TUTORIAL_QUESTION, true))) {
      dialog.t = translator(cmd.lang ?? 'en');
      printManualSetup(dialog);
      return 0;
    }
    const lang = await askLanguage(dialog, cmd.lang);
    dialog.t = translator(lang);
    const { t, paint } = dialog;

    if (!write) host.stderr.write(infoLine(t(cmd.dryRun ? 'dryRun' : 'noTerminal')));
    const info = detectProject(await readProjectFiles(host, host.cwd));
    // Step 1: the package in four sentences, then the project (04-REQ-38, note #23).
    dialog.step(
      1,
      t('stepProject'),
      t('about1', { pkg: PACKAGE_NAME }),
      t('about2'),
      t('about3'),
      t('about4'),
    );
    dialog.say(...describeProject(info, t).map((line) => `  ${line}`));
    if (info.playwrightConfig === null) {
      // Before any question and without writing anything (04-REQ-41).
      return dialog.error('INIT_NO_PLAYWRIGHT_CONFIG', 'noConfigMessage', 'noConfigHint', {
        dir: host.cwd,
        command: INIT_COMMAND,
      });
    }
    if (
      info.playwrightVersion !== null &&
      !versionAtLeast(info.playwrightVersion, host.minPlaywrightVersion)
    ) {
      return dialog.error('INIT_PLAYWRIGHT_TOO_OLD', 'tooOldMessage', 'tooOldHint', {
        version: info.playwrightVersion,
        min: host.minPlaywrightVersion,
        pkg: PACKAGE_NAME,
        command: INIT_COMMAND,
      });
    }
    await dialog.pause();

    const answers = await askAnswers(dialog, info);
    const plan = planInitChanges(info, answers, lang);
    const commands = runCommands(answers.script, info.packageManager, host.platform);

    dialog.stepOf(
      9,
      'stepChanges',
      plan.changes.length === 0 ? 'nothingToChange' : 'changesLesson',
    );
    let written: string[];
    try {
      written = await applyChanges(dialog, host, info, plan.changes, write);
    } catch (error) {
      if (!(error instanceof WriteFailed)) throw error;
      return dialog.error('INIT_WRITE_FAILED', 'writeFailedMessage', 'writeFailedHint', {
        detail: error.message,
      });
    }
    dialog.warn(plan.manualSteps);
    const redBox = plan.testObject === null ? null : testObjectBox(dialog, host, plan.testObject);
    if (redBox !== null) host.stdout.write(`\n${redBox}`);

    // Step 10: a check only when something was written and playwright.config is wrapped.
    dialog.stepOf(10, 'stepCheck', 'checkLesson');
    const configPath = info.playwrightConfig.path;
    const wrapped = info.existing.wrappedConfig || written.includes(configPath);
    let checkCode: number | null = null;
    if (dialog.interactive && written.length > 0 && wrapped) {
      if (await dialog.confirm(t('checkQuestion'), true)) {
        prompt?.close();
        checkCode = await runCheck(dialog, host, info, answers, commands);
        if (checkCode === 130) {
          host.stderr.write(infoLine(t('interrupted')));
          return 130;
        }
      }
    } else {
      dialog.line(t('skipped'), 'dim');
    }

    dialog.step(11, t('stepSummary'));
    if (written.length > 0)
      dialog.say(
        `  ${t('changedFiles')}`,
        ...written.map((p) => `    ${paint('✔', 'green')} ${p}`),
      );
    else if (write) dialog.say(`  ${t('noFilesChanged')}`);
    else
      dialog.say(
        `  ${t('plannedChanges')}`,
        ...plan.changes.map((c) => `    · ${c.path} (${changeKind(c, t)})`),
      );
    if (plan.manualSteps.length > 0)
      dialog.line(`⚠ ${t('manualSteps', { count: plan.manualSteps.length })}`, 'yellow');
    if (redBox !== null) host.stdout.write(redBox);
    if (checkCode !== null && checkCode !== 0)
      dialog.say(`  ${t('checkExit', { code: checkCode })}`);
    dialog.say('', `  ${paint(t('runLine', { command: commands.test }), 'bold')}`);
    dialog.line(t('runLesson'), 'dim');
    if (host.platform === 'win32') dialog.line(t('windowsNote'), 'dim');
    dialog.say(
      `  ${paint(t('nextSteps'), 'bold')}`,
      ...nextSteps(dialog, info, answers, commands, written, checkCode !== null).map(
        (s, i) => `    ${i + 1}. ${s}`,
      ),
    );
    const oldScripts = info.existing.scripts.filter((name) => name.startsWith('perf:'));
    if (oldScripts.length > 0) dialog.say(`  ${t('oldScripts', { names: oldScripts.join(', ') })}`);
    dialog.say(`  ${t('originsNote')}`);
    const links = [`${DOCS}/adoption.md`, `${DOCS}/cli.md`, `${DOCS}/ci.md`];
    if (answers.script !== null) links.push(`${DOCS}/dynamic-environments.md`);
    dialog.line(t('docs', { links: links.join(' · ') }), 'dim');
    if (write) dialog.line(`✔ ${t('finished')}`, 'green');
    return 0;
  } catch (error) {
    if (error instanceof PromptAborted) {
      host.stderr.write(infoLine(dialog.t('interrupted')));
      return 130;
    }
    throw error;
  } finally {
    prompt?.close();
  }
}
