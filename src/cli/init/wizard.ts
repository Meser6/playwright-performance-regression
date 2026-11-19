// The init wizard (04, chapter 4.10): eleven steps, each with a short lesson. Interactive only
// when stdin and stdout are terminals; --yes takes the default answers and writes, and without a
// terminal and without --yes it only shows the plan, like --dry-run (04-REQ-37, 04-D-20).
// Nothing is written before step 9 (04-REQ-41).
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
import type { InitAnswers } from './perf-config.ts';
import { isProtected, planInitChanges, plannedScripts } from './plan.ts';
import type { FileChange } from './plan.ts';
import { PromptAborted } from './prompt.ts';

export interface InitCommand {
  yes: boolean;
  dryRun: boolean;
}

const STEPS = 11;
const PLATFORM_NAMES: Record<CiPlatform, string> = {
  github: 'GitHub Actions',
  gitlab: 'GitLab CI',
  jenkins: 'Jenkins',
  azure: 'Azure Pipelines',
};
const DOCS = `${REPOSITORY_URL}/blob/main/docs`;

class WriteFailed extends Error {}

/** Asks questions in a terminal, or prints the default answer without one. */
class Dialog {
  readonly #host: CliHost;
  readonly #prompt: Prompt | null;
  readonly #style: OutputStyle;

  constructor(host: CliHost, prompt: Prompt | null, style: OutputStyle) {
    this.#host = host;
    this.#prompt = prompt;
    this.#style = style;
  }

  get interactive(): boolean {
    return this.#prompt !== null;
  }

  say(...lines: string[]): void {
    this.#host.stdout.write(lines.map((l) => `${l}\n`).join(''));
  }

  step(n: number, title: string, ...lesson: string[]): void {
    this.say('', `Step ${n}/${STEPS} · ${title}`, ...lesson.map((l) => `  ${l}`));
  }

  warn(issues: readonly CliIssue[]): void {
    if (issues.length > 0) this.#host.stderr.write(formatIssues(issues, 'warning', this.#style));
  }

  /** A question with a default; `parse` returns the value or null to ask again. */
  async ask<T>(
    question: string,
    shownDefault: string,
    fallback: T,
    parse: (answer: string) => T | null,
    fallbackText = shownDefault,
  ): Promise<T> {
    const text = `  ${question} (${shownDefault}) `;
    if (this.#prompt === null) {
      this.say(`${text}→ ${fallbackText}`);
      return fallback;
    }
    for (;;) {
      const answer = (await this.#prompt.ask(text)).trim();
      if (answer === '') return fallback;
      const value = parse(answer);
      if (value !== null) return value;
      this.say('  Please answer again: that value is not valid here.');
    }
  }

  confirm(question: string, fallback: boolean): Promise<boolean> {
    return this.ask(
      question,
      fallback ? 'Y/n' : 'y/N',
      fallback,
      (a) => (/^(y|yes)$/iu.test(a) ? true : /^(n|no)$/iu.test(a) ? false : null),
      fallback ? 'yes' : 'no',
    );
  }

  async pause(): Promise<void> {
    if (this.#prompt !== null) await this.#prompt.ask('  Press Enter to continue. ');
  }
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function runCommand(manager: ProjectInfo['packageManager'], script: string): string {
  return manager === 'npm' ? `npm run ${script}` : `${manager} ${script}`;
}

function describeProject(info: ProjectInfo): string[] {
  const config = info.playwrightConfig;
  const lines = [
    `${config?.path ?? '-'} · Playwright ${info.playwrightVersion ?? 'version unknown'} · ${info.packageManager} · ${info.moduleType === 'esm' ? 'ES modules' : 'CommonJS'}`,
    `Test directory "${info.testDir}": ${count(info.filesImportingPlaywrightTest.length, 'file imports', 'files import')} @playwright/test, ${count(info.filesWithExtend.length, 'file calls', 'files call')} .extend()`,
  ];
  if (info.baseUrls.length > 0 || info.projectNames.length > 0) {
    lines.push(
      [
        info.baseUrls.length > 0 ? `baseURL ${info.baseUrls.join(', ')}` : null,
        info.projectNames.length > 0 ? `projects ${info.projectNames.join(', ')}` : null,
      ]
        .filter((part) => part !== null)
        .join(' · '),
    );
  }
  lines.push(`CI: ${info.ciPlatform === null ? 'none found' : PLATFORM_NAMES[info.ciPlatform]}`);
  if (
    info.existing.wrappedConfig ||
    info.existing.wrappedTest ||
    info.existing.perfConfig !== null
  ) {
    lines.push(
      `Already set up: ${[
        info.existing.wrappedConfig ? 'withPerf()' : null,
        info.existing.wrappedTest ? 'measured test object' : null,
        info.existing.perfConfig,
      ]
        .filter((part) => part !== null)
        .join(', ')}`,
    );
  }
  return lines;
}

async function askAnswers(dialog: Dialog, info: ProjectInfo): Promise<InitAnswers> {
  dialog.step(
    2,
    'How it works',
    `1. Measurement runs are separate from your usual test runs: "${CLI_COMMAND} test" runs the tests in perf mode.`,
    '2. Every test runs several times in one worker, so each backend request gets enough samples.',
    '3. Requests are grouped into endpoint keys such as "GET api /users/:id".',
    `4. "${CLI_COMMAND} thresholds" derives thresholds per key into files you commit to the repository.`,
    '5. Exit code 0 means ok, 2 a performance regression, 3 a tool or config error.',
  );
  await dialog.pause();

  dialog.step(3, 'Backend', 'Endpoint keys start with a short label of the backend origin.');
  const originLabels: Record<string, string> = {};
  if (info.baseUrls.length === 0) {
    dialog.say('  No baseURL found in playwright.config: requests are labeled with their host.');
  }
  const used = new Set<string>();
  for (const origin of info.baseUrls) {
    const fallback = defaultLabel(origin, used);
    const label = await dialog.ask(`Label for ${origin}?`, fallback, fallback, (a) =>
      /^[a-z0-9.-]{1,64}$/u.test(a) ? a : null,
    );
    used.add(label);
    originLabels[origin] = label;
  }

  const tagged = info.taggedPerfTestFiles > 0;
  dialog.step(
    4,
    'Which tests',
    'A measurement run takes about (tests × repetitions) test runs on 1 worker, so measure the tests',
    `that call the important backend endpoints. Files with tests tagged @perf: ${info.taggedPerfTestFiles}.`,
  );
  if (!tagged) {
    dialog.warn([
      {
        code: 'INIT_NO_TAGGED_TESTS',
        message: 'No test is tagged @perf, so all tests are proposed.',
        hint: "Tag the tests to measure with test('title @perf', ...) or test('title', { tag: '@perf' }, ...), then choose @perf.",
      },
    ]);
  }
  const scope = await dialog.ask<'all' | 'tagged'>(
    'Measure all tests or only tests tagged @perf? [all/@perf]',
    tagged ? '@perf' : 'all',
    tagged ? 'tagged' : 'all',
    (a) => (a === 'all' ? 'all' : a === '@perf' || a === 'perf' ? 'tagged' : null),
  );

  dialog.step(
    5,
    'Repetitions',
    'Each rule needs a minimum number of samples per endpoint (minSamples), and samples are',
    'calls per test × tests × repetitions.',
  );
  const repeatTest = await dialog.ask(
    'Repetitions per test in measurement runs?',
    String(DEFAULT_ANSWERS_REPEAT),
    DEFAULT_ANSWERS_REPEAT,
    (a) => {
      const n = parseRepeat(a);
      return n !== null && resolveConfig({ run: { repeat: { test: n } } }, {}).ok ? n : null;
    },
  );

  dialog.step(
    6,
    'Trial period',
    'In warn-only mode regressions are reported but do not fail the run, so you can watch the',
    'results for a few weeks before they block builds.',
  );
  const warnOnly = await dialog.confirm('Start in warn-only mode for the first weeks?', true);

  dialog.step(
    7,
    'Environments',
    'Each environment gets its own thresholds files (perf-thresholds.<kind>.<label>.json).',
  );
  let envLabels: string[] = [];
  if (await dialog.confirm('Do you run against several environments?', false)) {
    envLabels = await dialog.ask(
      'Environment labels, separated by commas?',
      'none',
      [] as string[],
      (a) => {
        const labels = [
          ...new Set(
            a
              .split(',')
              .map((l) => l.trim())
              .filter((l) => l !== ''),
          ),
        ];
        return labels.length > 0 && labels.every(isEnvLabel) ? labels : null;
      },
    );
  }

  dialog.step(
    8,
    'CI',
    'A CI job runs the measurement on pull requests and every night and keeps the report.',
  );
  let addCi = false;
  if (info.ciPlatform === null) {
    dialog.say(
      `  No CI configuration found. Recipes for GitHub Actions, GitLab CI, Jenkins and Azure Pipelines: ${DOCS}/ci.md`,
    );
  } else {
    addCi = await dialog.confirm(
      `Add a CI job for measurement runs (${PLATFORM_NAMES[info.ciPlatform]})?`,
      true,
    );
  }
  return { originLabels, scope, repeatTest, warnOnly, envLabels, addCi };
}

function changeTitle(change: FileChange): string {
  return `${change.path} (${change.kind === 'create' ? 'new file' : 'change'})`;
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
  const written: string[] = [];
  for (const change of changes) {
    dialog.say(
      '',
      `  ${changeTitle(change)}`,
      ...unifiedDiff(change)
        .trimEnd()
        .split('\n')
        .map((l) => `    ${l}`),
    );
    let apply: boolean;
    if (isProtected(info, change.path)) {
      // Never overwritten without its own confirmation; --yes does not count (04-REQ-40).
      if (dialog.interactive)
        apply = await dialog.confirm(`${change.path} exists. Overwrite it?`, false);
      else {
        dialog.say(
          `  ${change.path} exists and is kept${yes ? ' (--yes does not overwrite it)' : ''}.`,
        );
        apply = false;
      }
    } else {
      apply = await dialog.confirm('Apply this change?', true);
    }
    if (!apply || !write) continue;
    try {
      await host.writeText(host.paths.join(host.cwd, change.path), change.after);
    } catch (error) {
      throw new WriteFailed(
        `${change.path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    written.push(change.path);
  }
  return written;
}

function nextSteps(info: ProjectInfo, answers: InitAnswers, written: readonly string[]): string[] {
  const scripts = Object.keys(plannedScripts(answers));
  const thresholds = scripts.find((s) => s.startsWith('perf:thresholds')) as string;
  const test = scripts.find((s) => s.startsWith('perf:test')) as string;
  const steps = [
    `${runCommand(info.packageManager, thresholds)}: derive the thresholds and commit the perf-thresholds.*.json files (derive them on the CI machines for stable values).`,
    `${runCommand(info.packageManager, test)}: a measurement run that fails on a regression.`,
  ];
  const platform = info.ciPlatform;
  if (answers.addCi && platform !== null) {
    const ci = CI_TARGETS[platform].path(answers.envLabels[0] ?? null);
    if (platform === 'jenkins')
      steps.push(`Create a Pipeline job in Jenkins with the script path ${ci}.`);
    if (platform === 'azure') steps.push(`Create a pipeline in Azure DevOps from ${ci}.`);
  }
  if (answers.warnOnly)
    steps.push('After the trial period remove gate.warnOnly from pw-perf.config.ts.');
  if (written.length === 0 && scripts.length > 0)
    steps.unshift('Apply the changes above (run init again in a terminal or with --yes).');
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
  const prompt = interactive ? host.createPrompt() : null;
  const dialog = new Dialog(host, prompt, style);
  try {
    if (!write) {
      host.stderr.write(
        infoLine(
          cmd.dryRun
            ? 'dry run: the planned changes are shown and nothing is written.'
            : 'no terminal: the default answers are used and nothing is written (like --dry-run). Use --yes to write the changes.',
        ),
      );
    }
    const info = detectProject(await readProjectFiles(host, host.cwd));
    dialog.step(1, 'Project', ...describeProject(info));
    if (info.playwrightConfig === null) {
      host.stderr.write(
        formatIssues(
          [
            {
              code: 'INIT_NO_PLAYWRIGHT_CONFIG',
              message: `No playwright.config.* in ${host.cwd}.`,
              hint: `Run "${CLI_COMMAND} init" in the directory of playwright.config (in a monorepo: the package with the Playwright tests).`,
            },
          ],
          'error',
          style,
        ),
      );
      return 3;
    }
    if (
      info.playwrightVersion !== null &&
      !versionAtLeast(info.playwrightVersion, host.minPlaywrightVersion)
    ) {
      host.stderr.write(
        formatIssues(
          [
            {
              code: 'INIT_PLAYWRIGHT_TOO_OLD',
              message: `@playwright/test ${info.playwrightVersion} is older than ${host.minPlaywrightVersion}, the lowest version ${PACKAGE_NAME} supports.`,
              hint: `Update @playwright/test to ${host.minPlaywrightVersion} or later, then run "${CLI_COMMAND} init" again.`,
            },
          ],
          'error',
          style,
        ),
      );
      return 3;
    }

    const answers = await askAnswers(dialog, info);
    const plan = planInitChanges(info, answers);

    dialog.step(
      9,
      'Changes',
      plan.changes.length === 0
        ? 'Nothing to change: the project is already set up for these answers.'
        : 'Each change is shown as a diff before it is applied.',
    );
    let written: string[];
    try {
      written = await applyChanges(dialog, host, info, plan.changes, write, cmd.yes);
    } catch (error) {
      if (!(error instanceof WriteFailed)) throw error;
      host.stderr.write(
        formatIssues(
          [
            {
              code: 'INIT_WRITE_FAILED',
              message: `Could not write ${error.message}`,
              hint: 'Check the permissions of the file and its directory, then run init again.',
            },
          ],
          'error',
          style,
        ),
      );
      return 3;
    }
    dialog.warn(plan.manualSteps);

    dialog.step(
      10,
      'First measurement',
      `A thresholds run measures the tests and writes the thresholds files and the report (${DEFAULT_CONFIG.report.dir}/).`,
      'Thresholds measured on a laptop do not fit CI machines: derive the committed ones in CI.',
    );
    let firstRun = false;
    if (dialog.interactive && written.length > 0) {
      firstRun = await dialog.confirm('Run a first thresholds run now?', false);
    } else {
      dialog.say('  Skipped.');
    }

    dialog.step(11, 'Summary');
    if (written.length > 0) dialog.say('  Changed files:', ...written.map((p) => `    ${p}`));
    else if (write) dialog.say('  No files were changed.');
    else
      dialog.say(
        '  Planned changes (not written):',
        ...plan.changes.map((c) => `    ${changeTitle(c)}`),
      );
    if (plan.manualSteps.length > 0)
      dialog.say(`  Manual steps: ${plan.manualSteps.length} (see the warnings above).`);
    dialog.say(
      '  Next steps:',
      ...nextSteps(info, answers, written).map((s, i) => `    ${i + 1}. ${s}`),
    );
    dialog.say(`  Docs: ${DOCS}/adoption.md · ${DOCS}/ci.md · ${DOCS}/configuration.md`);
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
      host.stderr.write(infoLine('interrupted.'));
      return 130;
    }
    throw error;
  } finally {
    prompt?.close();
  }
}
