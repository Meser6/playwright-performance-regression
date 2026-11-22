// Run commands of the init wizard (04-REQ-55, 04-REQ-58; D-35): the test command C of the
// detected package manager, the commands of every mode shown by the wizard and written to the CI
// jobs, and the process of the wizard's check run. Nothing is executed here. Pure.
import type { CliIssue, Result } from '../../core/types/index.ts';
import type { PackageManager } from './detect.ts';

export interface RunCommands {
  /** C: the test command, e.g. "npx playwright test". */
  base: string;
  test: string;
  thresholds: string;
  check: string;
}

/** C for the package manager (04-REQ-55). */
export function testCommand(manager: PackageManager): string {
  return manager === 'npm'
    ? 'npx playwright test'
    : manager === 'pnpm'
      ? 'pnpm exec playwright test'
      : 'yarn playwright test';
}

/** The run commands of every mode (04-REQ-55): `PW_PERF_MODE=m C`, on Windows with cross-env. */
export function runCommands(manager: PackageManager, platform: string): RunCommands {
  const base = testCommand(manager);
  const prefix = platform === 'win32' ? 'npx cross-env ' : '';
  const mode = (m: string): string => `${prefix}PW_PERF_MODE=${m} ${base}`;
  return { base, test: mode('test'), thresholds: mode('thresholds'), check: mode('check') };
}

export interface SpawnSpec {
  file: string;
  args: string[];
  shell: boolean;
}

/**
 * The process of the wizard's check run (04-REQ-58), without spawning: the Playwright CLI of the
 * project through Node, without a shell. An error means: show the command instead.
 */
export function commandSpawn(input: {
  /** process.execPath. */
  nodePath: string;
  /** The Playwright CLI script, or null when @playwright/test is not installed. */
  playwrightCli: string | null;
  packageManager: PackageManager;
  platform: string;
}): Result<SpawnSpec, CliIssue> {
  if (input.playwrightCli === null) {
    return {
      ok: false,
      issues: [
        {
          code: 'INIT_MANUAL_STEP',
          message: '@playwright/test is not installed here',
          hint: `Run the check command yourself: ${runCommands(input.packageManager, input.platform).check}`,
        },
      ],
    };
  }
  return {
    ok: true,
    value: { file: input.nodePath, args: [input.playwrightCli, 'test'], shell: false },
  };
}
