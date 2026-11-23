// Run commands of the init wizard (04-REQ-55, 04-REQ-58; D-35): the test command C (the answer of
// step 6, by default the command of the detected package manager), the commands of every mode
// shown by the wizard (no CI jobs, 04-D-53), and the runs and process of the wizard's check.
// Nothing is executed here. Pure.
import type { CliIssue, Result } from '../../core/types/index.ts';
import { writeModeState } from '../../mode/index.ts';
import type { PackageManager } from './detect.ts';

export interface RunCommands {
  /** C: the test command, e.g. "npx playwright test". */
  base: string;
  test: string;
  thresholds: string;
  check: string;
}

/** The default C for the package manager (04-REQ-55). */
export function testCommand(manager: PackageManager): string {
  return manager === 'npm'
    ? 'npx playwright test'
    : manager === 'pnpm'
      ? 'pnpm exec playwright test'
      : 'yarn playwright test';
}

/** A script of package.json that runs Playwright tests. */
const PLAYWRIGHT_TEST = /\bplaywright\s+test\b/u;

/** `npm run <name>` and its forms for the package manager (04-REQ-55). */
export function scriptCommand(manager: PackageManager, name: string): string {
  return manager === 'yarn' ? `yarn ${name}` : `${manager} run ${name}`;
}

/**
 * The default answer of step 6 (04-REQ-55, 04-D-50): the only script with `playwright test` in
 * the package manager's form, else the command of the package manager.
 */
export function defaultTestCommand(
  manager: PackageManager,
  scripts: Readonly<Record<string, string>>,
): string {
  const runs = Object.keys(scripts).filter((name) => PLAYWRIGHT_TEST.test(scripts[name] ?? ''));
  return runs.length === 1 ? scriptCommand(manager, runs[0] as string) : testCommand(manager);
}

/** What step 6 says about the script a command runs (04-REQ-55, 04-D-50). */
export interface ScriptHints {
  /** The command or its script sets --reporter (RUN_REPORTER_FLAG, 04-REQ-61). */
  reporter: boolean;
  /** Commands before `playwright test` in the script, chained with && or ;, else null. */
  everyPass: string | null;
}

/** The package.json script a command runs (`npm run x`, `pnpm x`, `yarn run x`), or null. */
export function scriptOf(
  command: string,
  scripts: Readonly<Record<string, string>>,
): { name: string; text: string } | null {
  const m =
    /^(?:npm\s+(?:run|run-script)|pnpm(?:\s+run)?|yarn(?:\s+run)?)\s+([^\s'"&|;]+)(?:\s|$)/u.exec(
      command.trim(),
    );
  const name = m?.[1];
  if (name === undefined || !Object.hasOwn(scripts, name)) return null;
  return { name, text: scripts[name] as string };
}

/** The hints of step 6 for the command and the script it runs (04-REQ-55, 04-D-50). */
export function scriptHints(
  command: string,
  scripts: Readonly<Record<string, string>>,
): ScriptHints {
  const script = scriptOf(command, scripts)?.text ?? '';
  const reporter = /(?:^|\s)--reporter(?:[=\s]|$)/u;
  let everyPass: string | null = null;
  const at = script.search(PLAYWRIGHT_TEST);
  if (at > 0) {
    const before = script.slice(0, at);
    const separators = [...before.matchAll(/&&|;/gu)];
    const last = separators.at(-1);
    if (last !== undefined) everyPass = before.slice(0, last.index).trim() || null;
  }
  return { reporter: reporter.test(command) || reporter.test(script), everyPass };
}

/**
 * The run commands of every mode (04-REQ-55): `PW_PERF_MODE=m C` with C as typed, on Windows
 * with cross-env.
 */
export function runCommands(command: string, platform: string): RunCommands {
  const prefix = platform === 'win32' ? 'npx cross-env ' : '';
  const mode = (m: string): string => `${prefix}PW_PERF_MODE=${m} ${command}`;
  return {
    base: command,
    test: mode('test'),
    thresholds: mode('thresholds'),
    check: mode('check'),
  };
}

/** Passes of each run of the wizard's check (04-REQ-58, v4 D4b). */
export const CHECK_PASSES = 2;
/** Cap of checks.time.median.minSamples in the wizard's check, so 2 passes derive (04-D-46). */
export const CHECK_MIN_SAMPLES = 2;

/** One run of the wizard's check (04-REQ-58). */
export interface CheckRun {
  mode: 'thresholds' | 'test';
  /** Variables for the child process. */
  env: Record<string, string>;
  /** The command as shown, with the public variables in front of C. */
  shown: string;
}

/**
 * The two runs of the wizard's check (04-REQ-58, v4 D4b): C with PW_PERF_MODE=thresholds, then
 * with PW_PERF_MODE=test, both with PW_PERF_PASSES=2 and the internal PW_PERF_THRESHOLDS_DIR, so
 * the thresholds of the check stay in a temporary directory, and the internal
 * PW_PERF_MIN_SAMPLES=2, so a small suite derives thresholds (04-D-46). Internal variables are not shown.
 */
export function checkRuns(command: string, platform: string, thresholdsDir: string): CheckRun[] {
  const prefix = platform === 'win32' ? 'npx cross-env ' : '';
  const passes = String(CHECK_PASSES);
  return (['thresholds', 'test'] as const).map((mode) => ({
    mode,
    env: writeModeState({
      mode,
      passes: CHECK_PASSES,
      thresholdsDir,
      minSamples: CHECK_MIN_SAMPLES,
    }),
    shown: `${prefix}PW_PERF_MODE=${mode} PW_PERF_PASSES=${passes} ${command}`,
  }));
}

/** Why an answer of step 6 is not taken, or null (04-REQ-55): the wizard adds PW_PERF_MODE. */
export function commandProblem(command: string): 'variable' | null {
  return /PW_PERF_/u.test(command) ? 'variable' : null;
}

/**
 * True when the command chains commands outside quotes (`&&`, `||`, `;`, `|`): a
 * `PW_PERF_MODE=m ` prefix only reaches the first one (04-REQ-55). A POSIX-like scan of quotes
 * and backslashes; good enough for a hint.
 */
export function chainsCommands(command: string): boolean {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const c = command[i];
    if (quote === "'") {
      if (c === "'") quote = null;
    } else if (c === '\\') {
      i += 1;
    } else if (quote === '"') {
      if (c === '"') quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ';' || c === '|' || (c === '&' && command[i + 1] === '&')) {
      return true;
    }
  }
  return false;
}

export interface SpawnSpec {
  file: string;
  args: string[];
  /** false, true (the platform shell) or the path of a shell. */
  shell: boolean | string;
}

/**
 * The process of the wizard's check run (04-REQ-58), without spawning. The default C runs the
 * Playwright CLI of the project through Node, without a shell; an error means: show the command
 * instead. Any other C runs as typed through the user's shell: $SHELL (an absolute path) or
 * /bin/sh on POSIX, %ComSpec% on Windows. PW_PERF_MODE goes in the environment, not here.
 */
export function commandSpawn(input: {
  /** C, the answer of step 6. */
  command: string;
  /** process.execPath. */
  nodePath: string;
  /** The Playwright CLI script, or null when @playwright/test is not installed. */
  playwrightCli: string | null;
  packageManager: PackageManager;
  platform: string;
  /** $SHELL. */
  shell: string | undefined;
}): Result<SpawnSpec, CliIssue> {
  if (input.command !== testCommand(input.packageManager)) {
    const shell =
      input.platform === 'win32'
        ? true
        : input.shell !== undefined && input.shell.startsWith('/')
          ? input.shell
          : '/bin/sh';
    return { ok: true, value: { file: input.command, args: [], shell } };
  }
  if (input.playwrightCli === null) {
    return {
      ok: false,
      issues: [
        {
          code: 'INIT_MANUAL_STEP',
          message: '@playwright/test is not installed here',
          hint: `Run the check command yourself: ${runCommands(input.command, input.platform).check}`,
        },
      ],
    };
  }
  return {
    ok: true,
    value: { file: input.nodePath, args: [input.playwrightCli, 'test'], shell: false },
  };
}
