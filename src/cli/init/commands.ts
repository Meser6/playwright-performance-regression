// Run commands of the init wizard (04-REQ-55, 04-REQ-58; D-35): the test command C (the answer of
// step 6, by default the command of the detected package manager), the commands of every mode
// shown by the wizard and written to the CI jobs, and the process of the wizard's check run.
// Nothing is executed here. Pure.
import type { CliIssue, Result } from '../../core/types/index.ts';
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
