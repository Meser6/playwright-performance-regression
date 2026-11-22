// The init wizard (04, chapter 4.10): the tutorial question (0a), the language (0) and ten
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
import {
  chainsCommands,
  checkRuns,
  commandProblem,
  commandSpawn,
  runCommands,
  testCommand,
} from './commands.ts';
import type { CheckRun, RunCommands } from './commands.ts';
import { DEFAULT_ANSWERS_PASSES } from './defaults.ts';
import { detectProject } from './detect.ts';
import type { CiPlatform, ProjectInfo } from './detect.ts';
import { unifiedDiff } from './diff.ts';
import { readProjectFiles } from './files.ts';
import { LANGUAGES, LANGUAGE_NAMES, isWizardLanguage, translator } from './messages.ts';
import type { MessageKey, MessageValues, Translate, WizardLanguage } from './messages.ts';
import type { InitAnswers, MeasureAnswer } from './perf-config.ts';
import { isProtected, planInitChanges } from './plan.ts';
import type { FileChange, TestObjectBox } from './plan.ts';
import { PromptAborted } from './prompt.ts';

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

/**
 * Steps shown as [n/10] (04-REQ-38); a skipped step keeps its number, and step 9 is not shown at
 * all with the red box, so the summary stays [10/10] (04-D-43).
 */
const STEPS = 10;
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

  /** Step header in cyan ("[2/10] Which tests") and the lesson dimmed. */
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

  /**
   * A question with a default; `parse` returns the value or null to ask again, with `again(answer)`
   * as the reason when given.
   */
  async ask<T>(
    question: string,
    shownDefault: string,
    fallback: T,
    parse: (answer: string) => T | null,
    fallbackText = shownDefault,
    again?: (answer: string) => string,
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
      this.line(`⚠ ${again === undefined ? this.t('answerAgain') : again(answer)}`, 'yellow');
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

/** Step 1 after the two sentences: how to run, the other variables and the files (04-REQ-38). */
function printUsage(dialog: Dialog, platform: string): void {
  const { t, paint } = dialog;
  const prefix = platform === 'win32' ? 'npx cross-env ' : '';
  const command = t('usageCommandPlaceholder');
  const mode = (m: string): string => paint(`${prefix}PW_PERF_MODE=${m} ${command}`, 'cyan');
  const table = (rows: readonly (readonly [string, string])[]): string[] => {
    const width = Math.max(...rows.map(([name]) => name.length));
    return rows.map(([name, text]) => `    ${paint(name.padEnd(width), 'cyan')}  ${text}`);
  };
  const prefixFile = DEFAULT_CONFIG.thresholds.filePrefix;
  dialog.say(
    `  ${paint(t('usageTitle'), 'bold')}`,
    `    1. ${mode('thresholds')}`,
    `       ${t('usageThresholds')}`,
    `    2. ${t('usageCommit')}`,
    `    3. ${mode('test')}`,
    `       ${t('usageTest')}`,
  );
  dialog.line(t('usageCommand'), 'dim');
  dialog.say(
    `  ${paint(t('variablesTitle'), 'bold')}`,
    ...table([
      ['PW_PERF_MODE=check', t('varCheck')],
      ['PW_PERF_MAX_TESTS=<n>', t('varMaxTests')],
      ['PW_PERF_ENV=<label>', t('varEnv')],
      ['PW_PERF_PASSES=<n>', t('varPasses')],
      ['PW_PERF_PRUNE=1', t('varPrune')],
    ]),
    `  ${paint(t('filesTitle'), 'bold')}`,
    ...table([
      ['pw-perf.config.ts', t('fileConfig')],
      [`${prefixFile}*.json`, t('fileThresholds')],
      [`${DEFAULT_CONFIG.report.dir}/`, t('fileReport')],
    ]),
  );
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

async function askAnswers(dialog: Dialog, info: ProjectInfo): Promise<InitAnswers> {
  const { t } = dialog;
  dialog.step(
    2,
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
  const scope = await dialog.ask<'all' | 'tagged'>(t('scopeQuestion', { all }), all, 'all', (a) => {
    const answer = a.toLowerCase();
    if (answer === 'all' || answer === all) return 'all';
    return answer === '@perf' || answer === 'perf' ? 'tagged' : null;
  });
  if (scope === 'tagged') dialog.line(t('taggedSaved'), 'dim');

  dialog.stepOf(3, 'stepPasses', 'passesLesson');
  const passesTest = await dialog.ask(
    t('passesQuestion'),
    String(DEFAULT_ANSWERS_PASSES),
    DEFAULT_ANSWERS_PASSES,
    (a) => {
      const n = parsePasses(a);
      return n !== null && resolveConfig({ run: { passes: { test: n } } }, {}).ok ? n : null;
    },
  );

  // Step 4 always, also without test.step calls (04-REQ-47, 04-D-41).
  dialog.step(
    4,
    t('stepMeasure'),
    t('measureApi'),
    t('measureSteps'),
    t('stepsPrivacy'),
    t('stepFilesFound', { count: info.stepFiles }),
  );
  if (info.stepFiles === 0) dialog.line(t('noStepsFound'), 'dim');
  const measure = await dialog.ask<MeasureAnswer>(
    t('measureQuestion', { all }),
    all,
    'all',
    (a) => {
      const answer = a.toLowerCase();
      if (answer === 'all' || answer === all) return 'all';
      return answer === 'api' || answer === 'steps' ? answer : null;
    },
  );
  if (measure === 'steps' && info.stepFiles === 0)
    dialog.line(`⚠ ${t('onlyStepsNoSteps')}`, 'yellow');

  dialog.stepOf(5, 'stepPreset', 'presetLesson', 'presetStrict', 'presetNormal', 'presetLoose');
  const normal = DEFAULT_CONFIG.thresholds.preset;
  const preset = await dialog.ask<MarginPreset>(t('presetQuestion'), normal, normal, (a) => {
    const answer = a.toLowerCase() as MarginPreset;
    return MARGIN_PRESETS.includes(answer) ? answer : null;
  });

  // Step 6: the test command C as typed; Enter keeps the default, 'skip' also skips the check
  // (04-REQ-55, 04-REQ-58, 04-D-42).
  dialog.stepOf(6, 'stepCommand', 'commandLesson1', 'commandLesson2');
  const suggested = testCommand(info.packageManager);
  // An answer is never empty (Enter gives the default), so '' stands for 'skip'.
  const typed = await dialog.ask<string>(
    t('commandQuestion'),
    suggested,
    suggested,
    (a) => (a.toLowerCase() === 'skip' ? '' : commandProblem(a) === null ? a : null),
    suggested,
    () => t('commandVariable'),
  );
  const skipped = typed === '';
  const command = skipped ? suggested : typed;
  if (chainsCommands(command)) dialog.line(`⚠ ${t('commandChain')}`, 'yellow');

  dialog.stepOf(7, 'stepCi', 'ci1', 'ci2', 'ci3', 'ci4');
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
    scope,
    passesTest,
    measure,
    preset,
    command,
    addCi,
    runCheck: dialog.interactive && !skipped,
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
 * Names of the thresholds files the runs will write (04-REQ-59 step 3, 04-REQ-47): the api file
 * unless only steps are measured, the step file for only steps, or for all with test.step calls.
 */
function thresholdsFiles(info: ProjectInfo, answers: InitAnswers): string[] {
  const prefix = DEFAULT_CONFIG.thresholds.filePrefix;
  const files: string[] = [];
  if (answers.measure !== 'steps') files.push(`${prefix}.json`);
  if (answers.measure === 'steps' || (answers.measure === 'all' && info.stepFiles > 0))
    files.push(`${prefix}.steps.json`);
  return files;
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

/** Exit code of one run of the wizard's check. */
interface CheckResult {
  mode: CheckRun['mode'];
  code: number;
}

/**
 * Step 9 (04-REQ-58, v4 D4b): runs the test command of step 6 twice, as a child process with the
 * terminal: PW_PERF_MODE=thresholds, then PW_PERF_MODE=test, both with PW_PERF_PASSES=2 and the
 * thresholds in a temporary directory that is removed afterwards. Returns the exit codes of the
 * runs that ran (an empty list when the command is shown instead); Ctrl+C (130) stops the check.
 */
async function runCheck(
  dialog: Dialog,
  host: CliHost,
  info: ProjectInfo,
  commands: RunCommands,
): Promise<CheckResult[]> {
  const spec = commandSpawn({
    command: commands.base,
    nodePath: host.execPath,
    playwrightCli: host.resolvePlaywright(host.cwd)?.cliPath ?? null,
    packageManager: info.packageManager,
    platform: host.platform,
    shell: host.env.SHELL,
  });
  if (!spec.ok) {
    dialog.line(dialog.t('checkManual', { command: commands.check }), 'yellow');
    return [];
  }
  const inherited: Record<string, string> = {};
  for (const [name, value] of Object.entries(host.env))
    if (value !== undefined) inherited[name] = value;
  const results: CheckResult[] = [];
  const dir = await host.makeTempDir('pw-perf-check-');
  // Ctrl+C goes to the whole process group: the run stops and the wizard reports 130.
  const stop = host.onSignal('SIGINT', () => undefined);
  try {
    for (const run of checkRuns(commands.base, host.platform, dir)) {
      dialog.line(`$ ${run.shown}`, 'dim');
      const child = host.spawnProcess(spec.value.file, spec.value.args, {
        cwd: host.cwd,
        env: { ...inherited, ...run.env },
        stdio: 'inherit',
        shell: spec.value.shell,
      });
      const code = await new Promise<number>((resolve) => {
        child.once('exit', (exit, signal) => resolve(signal === 'SIGINT' ? 130 : (exit ?? 1)));
        child.once('error', () => resolve(1));
      });
      results.push({ mode: run.mode, code });
      if (code === 130) break;
      dialog.line(dialog.t('checkExit', { mode: run.mode, code }), code === 0 ? 'green' : 'yellow');
    }
  } finally {
    stop();
    await host.removeDir(dir);
  }
  return results;
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
    // Step 1: what the package does and how to run it; the detection stays silent and only a
    // missing playwright.config or a too old Playwright stops here (04-REQ-38).
    dialog.step(1, t('stepProject'), t('about1', { pkg: PACKAGE_NAME }), t('about2'));
    printUsage(dialog, host.platform);
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
    const commands = runCommands(answers.command, host.platform);

    dialog.stepOf(
      8,
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

    // Step 9: a check only when something was written, playwright.config is wrapped and step 6
    // was not skipped; with the red box nothing would be measured, so no step 9 at all (04-REQ-58).
    const configPath = info.playwrightConfig.path;
    const wrapped = info.existing.wrappedConfig || written.includes(configPath);
    let checkResults: CheckResult[] | null = null;
    if (redBox === null) {
      dialog.stepOf(9, 'stepCheck', 'checkLesson');
      if (answers.runCheck && written.length > 0 && wrapped) {
        if (await dialog.confirm(t('checkQuestion'), true)) {
          prompt?.close();
          checkResults = await runCheck(dialog, host, info, commands);
          if (checkResults.some((r) => r.code === 130)) {
            host.stderr.write(infoLine(t('interrupted')));
            return 130;
          }
        }
      } else {
        dialog.line(t('skipped'), 'dim');
      }
    }

    dialog.step(10, t('stepSummary'));
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
    for (const r of checkResults ?? [])
      if (r.code !== 0) dialog.say(`  ${t('checkExit', { mode: r.mode, code: r.code })}`);
    dialog.say('', `  ${paint(t('runLine', { command: commands.test }), 'bold')}`);
    dialog.line(t('runLesson'), 'dim');
    if (host.platform === 'win32') dialog.line(t('windowsNote'), 'dim');
    dialog.say(
      `  ${paint(t('nextSteps'), 'bold')}`,
      ...nextSteps(
        dialog,
        info,
        answers,
        commands,
        written,
        checkResults !== null && checkResults.length > 0,
      ).map((s, i) => `    ${i + 1}. ${s}`),
    );
    const oldScripts = info.existing.scripts.filter((name) => name.startsWith('perf:'));
    if (oldScripts.length > 0) dialog.say(`  ${t('oldScripts', { names: oldScripts.join(', ') })}`);
    dialog.say(`  ${t('originsNote')}`);
    const links = [`${DOCS}/adoption.md`, `${DOCS}/cli.md`, `${DOCS}/ci.md`];
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
