// The init wizard (04, chapter 4.10): the tutorial question (0a), the language (0) and eleven
// steps, each with a short lesson. Interactive only when stdin and stdout are terminals; --yes
// takes the default answers and writes, and without a terminal and without --yes it only shows
// the plan, like --dry-run (04-REQ-37, 04-D-20). Declining the tutorial (or --no-tutorial) prints
// the manual setup and changes nothing (04-REQ-45). Texts in the chosen language (04-REQ-43),
// colors by 04-REQ-44. Nothing is written before step 9 (04-REQ-41).
import { colorEnabled, painter } from '../../console/color.ts';
import type { ColorStyle, Painter } from '../../console/color.ts';
import { DEFAULT_CONFIG, resolveConfig } from '../../core/config/index.ts';
import { CLI_COMMAND, PACKAGE_NAME, REPOSITORY_URL } from '../../core/types/index.ts';
import type { CliIssue } from '../../core/types/index.ts';
import { isEnvLabel, parseRepeat } from '../../mode/index.ts';
import type { CliHost, Prompt } from '../host.ts';
import { formatIssues, infoLine } from '../output.ts';
import type { OutputStyle } from '../output.ts';
import { runTests, versionAtLeast } from '../run.ts';
import { CI_TARGETS } from './ci.ts';
import { detectProject } from './detect.ts';
import type { CiPlatform, ProjectInfo } from './detect.ts';
import { unifiedDiff } from './diff.ts';
import { readProjectFiles } from './files.ts';
import { DEFAULT_ANSWERS_REPEAT, defaultLabel } from './defaults.ts';
import { LANGUAGES, LANGUAGE_NAMES, isWizardLanguage, translator } from './messages.ts';
import type { MessageKey, MessageValues, Translate, WizardLanguage } from './messages.ts';
import type { InitAnswers } from './perf-config.ts';
import { isProtected, planInitChanges, plannedScripts } from './plan.ts';
import type { FileChange } from './plan.ts';
import { PromptAborted } from './prompt.ts';

export interface InitCommand {
  yes: boolean;
  dryRun: boolean;
  lang?: WizardLanguage;
  noTutorial?: boolean;
}

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

class WriteFailed extends Error {}

/** Asks questions in a terminal, or prints the default answer without one. */
class Dialog {
  readonly #host: CliHost;
  readonly #prompt: Prompt | null;
  readonly #style: OutputStyle;
  /** Colors of stdout (04-REQ-44). */
  readonly paint: Painter;
  t: Translate = translator('en');

  constructor(host: CliHost, prompt: Prompt | null, style: OutputStyle) {
    this.#host = host;
    this.#prompt = prompt;
    this.#style = style;
    this.paint = painter(colorEnabled(host.stdout, host.env));
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

  /** Step header in cyan ("[3/11] Backend") and the lesson dimmed. */
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

function runCommand(manager: ProjectInfo['packageManager'], script: string): string {
  return manager === 'npm' ? `npm run ${script}` : `${manager} ${script}`;
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

/** Step 0a declined or --no-tutorial: the manual setup, no changes (04-REQ-45). */
function printManualSetup(dialog: Dialog): void {
  const { t, paint } = dialog;
  const cmd = (text: string): string => paint(text, 'cyan');
  dialog.say('');
  dialog.line(`✔ ${t('declinedInstalled', { pkg: PACKAGE_NAME })}`, 'green');
  dialog.say(
    `  ${paint(t('declinedSteps'), 'bold')}`,
    `    1. ${t('declinedConfig', { config: `${PACKAGE_NAME}/config` })}`,
    `    2. ${t('declinedTest', { fixture: `${PACKAGE_NAME}/fixture`, test: `${PACKAGE_NAME}/test` })}`,
    `    3. ${t('declinedRun', { thresholds: cmd(`${CLI_COMMAND} thresholds`), test: cmd(`${CLI_COMMAND} test`) })}`,
  );
  dialog.line(t('declinedDocs', { url: `${DOCS}/adoption.md` }), 'dim');
  dialog.say(`  ${t('declinedLater', { init: cmd(`${CLI_COMMAND} init`) })}`);
}

/** Step 0: the language from --lang, the answer in a terminal, or English (04-REQ-43). */
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
    t('stepHow'),
    `1. ${t('how1', { test: `${CLI_COMMAND} test` })}`,
    `2. ${t('how2')}`,
    `3. ${t('how3')}`,
    `4. ${t('how4', { thresholds: `${CLI_COMMAND} thresholds` })}`,
    `5. ${t('how5')}`,
  );
  await dialog.pause();

  dialog.stepOf(3, 'stepBackend', 'backendLesson');
  const originLabels: Record<string, string> = {};
  if (info.baseUrls.length === 0) dialog.say(`  ${t('noBaseUrl')}`);
  const used = new Set<string>();
  for (const origin of info.baseUrls) {
    const fallback = defaultLabel(origin, used);
    const label = await dialog.ask(t('labelQuestion', { origin }), fallback, fallback, (a) =>
      /^[a-z0-9.-]{1,64}$/u.test(a) ? a : null,
    );
    used.add(label);
    originLabels[origin] = label;
  }

  const tagged = info.taggedPerfTestFiles > 0;
  dialog.step(
    4,
    t('stepTests'),
    t('testsLesson'),
    t('taggedFiles', { count: info.taggedPerfTestFiles }),
  );
  if (!tagged) {
    dialog.warn([
      {
        code: 'INIT_NO_TAGGED_TESTS',
        message: t('noTaggedMessage'),
        hint: t('noTaggedHint'),
      },
    ]);
  }
  const all = t('scopeAll');
  const scope = await dialog.ask<'all' | 'tagged'>(
    t('scopeQuestion', { all }),
    tagged ? '@perf' : all,
    tagged ? 'tagged' : 'all',
    (a) => {
      const answer = a.toLowerCase();
      if (answer === 'all' || answer === all) return 'all';
      return answer === '@perf' || answer === 'perf' ? 'tagged' : null;
    },
  );

  dialog.stepOf(5, 'stepRepeat', 'repeatLesson');
  const repeatTest = await dialog.ask(
    t('repeatQuestion'),
    String(DEFAULT_ANSWERS_REPEAT),
    DEFAULT_ANSWERS_REPEAT,
    (a) => {
      const n = parseRepeat(a);
      return n !== null && resolveConfig({ run: { repeat: { test: n } } }, {}).ok ? n : null;
    },
  );

  dialog.stepOf(6, 'stepTrial', 'trialLesson');
  const warnOnly = await dialog.confirm(t('warnOnlyQuestion'), true);

  dialog.stepOf(7, 'stepEnvs', 'envsLesson');
  let envLabels: string[] = [];
  if (await dialog.confirm(t('envsQuestion'), false)) {
    envLabels = await dialog.ask(t('envLabelsQuestion'), t('none'), [] as string[], (a) => {
      const labels = [
        ...new Set(
          a
            .split(',')
            .map((l) => l.trim())
            .filter((l) => l !== ''),
        ),
      ];
      return labels.length > 0 && labels.every(isEnvLabel) ? labels : null;
    });
  }

  dialog.stepOf(8, 'stepCi', 'ciLesson');
  let addCi = false;
  if (info.ciPlatform === null) {
    dialog.say(`  ${t('noCi', { url: `${DOCS}/ci.md` })}`);
  } else {
    addCi = await dialog.confirm(
      t('ciQuestion', { platform: PLATFORM_NAMES[info.ciPlatform] }),
      true,
    );
  }
  return { originLabels, scope, repeatTest, warnOnly, envLabels, addCi };
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

/** Step 9: diffs, confirmations and writes. Returns the paths written. */
async function applyChanges(
  dialog: Dialog,
  host: CliHost,
  info: ProjectInfo,
  changes: readonly FileChange[],
  write: boolean,
  yes: boolean,
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
      // Never overwritten without its own confirmation; --yes does not count (04-REQ-40).
      if (dialog.interactive)
        apply = await dialog.confirm(t('overwriteQuestion', { path: change.path }), false);
      else {
        dialog.say(`  ${t(yes ? 'keptWithYes' : 'kept', { path: change.path })}`);
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

function nextSteps(
  dialog: Dialog,
  info: ProjectInfo,
  answers: InitAnswers,
  written: readonly string[],
): string[] {
  const { t, paint } = dialog;
  const scripts = Object.keys(plannedScripts(answers));
  const thresholds = scripts.find((s) => s.startsWith('perf:thresholds')) as string;
  const test = scripts.find((s) => s.startsWith('perf:test')) as string;
  const command = (script: string): string =>
    paint(runCommand(info.packageManager, script), 'cyan');
  const steps = [
    t('nextThresholds', { command: command(thresholds) }),
    t('nextTest', { command: command(test) }),
  ];
  const platform = info.ciPlatform;
  if (answers.addCi && platform !== null) {
    const ci = CI_TARGETS[platform].path(answers.envLabels[0] ?? null);
    if (platform === 'jenkins') steps.push(t('nextJenkins', { path: ci }));
    if (platform === 'azure') steps.push(t('nextAzure', { path: ci }));
  }
  if (answers.warnOnly) steps.push(t('nextWarnOnly'));
  if (written.length === 0 && scripts.length > 0) steps.unshift(t('nextApply'));
  return steps;
}

export async function runInit(
  cmd: InitCommand,
  host: CliHost,
  style: OutputStyle,
): Promise<number> {
  const interactive =
    !cmd.yes && !cmd.dryRun && host.stdin.isTTY === true && host.stdout.isTTY === true;
  const write = !cmd.dryRun && (cmd.yes || interactive);
  const prompt = interactive && cmd.noTutorial !== true ? host.createPrompt() : null;
  const dialog = new Dialog(host, prompt, style);
  try {
    // Step 0a: with --yes or without a terminal the question is skipped (04-REQ-45).
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
    dialog.step(1, t('stepProject'), ...describeProject(info, t));
    if (info.playwrightConfig === null) {
      return dialog.error('INIT_NO_PLAYWRIGHT_CONFIG', 'noConfigMessage', 'noConfigHint', {
        dir: host.cwd,
        command: CLI_COMMAND,
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
        command: CLI_COMMAND,
      });
    }

    const answers = await askAnswers(dialog, info);
    const plan = planInitChanges(info, answers, lang);

    dialog.stepOf(
      9,
      'stepChanges',
      plan.changes.length === 0 ? 'nothingToChange' : 'changesLesson',
    );
    let written: string[];
    try {
      written = await applyChanges(dialog, host, info, plan.changes, write, cmd.yes);
    } catch (error) {
      if (!(error instanceof WriteFailed)) throw error;
      return dialog.error('INIT_WRITE_FAILED', 'writeFailedMessage', 'writeFailedHint', {
        detail: error.message,
      });
    }
    dialog.warn(plan.manualSteps);

    dialog.step(
      10,
      t('stepFirstRun'),
      t('firstRunLesson', { dir: DEFAULT_CONFIG.report.dir }),
      t('firstRunLaptop'),
    );
    let firstRun = false;
    if (dialog.interactive && written.length > 0) {
      firstRun = await dialog.confirm(t('firstRunQuestion'), false);
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
    dialog.say(
      `  ${paint(t('nextSteps'), 'bold')}`,
      ...nextSteps(dialog, info, answers, written).map((s, i) => `    ${i + 1}. ${s}`),
    );
    dialog.line(
      t('docs', { links: `${DOCS}/adoption.md · ${DOCS}/ci.md · ${DOCS}/configuration.md` }),
      'dim',
    );
    if (write) dialog.line(`✔ ${t('finished')}`, 'green');
    prompt?.close();

    if (firstRun) {
      const args = answers.scope === 'tagged' ? ['--grep', '@perf'] : [];
      return await runTests(
        { kind: 'run', mode: 'thresholds', prune: false, playwrightArgs: args, listOnly: false },
        host,
      );
    }
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
