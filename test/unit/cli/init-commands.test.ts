// Init wizard: run commands and the check process (04-REQ-55, 04-REQ-58).
import { describe, expect, test } from 'vitest';
import {
  chainsCommands,
  checkRuns,
  commandProblem,
  commandSpawn,
  runCommands,
  testCommand,
} from '../../../src/cli/init/commands.ts';
import { detectProject } from '../../../src/cli/init/detect.ts';

describe('run commands (04-REQ-55)', () => {
  test('04-AC-30 env-prefixed commands for npm, pnpm, yarn and Windows', () => {
    expect(runCommands(testCommand('npm'), 'linux')).toEqual({
      base: 'npx playwright test',
      test: 'PW_PERF_MODE=test npx playwright test',
      thresholds: 'PW_PERF_MODE=thresholds npx playwright test',
      check: 'PW_PERF_MODE=check npx playwright test',
    });
    expect(runCommands(testCommand('pnpm'), 'darwin').test).toBe(
      'PW_PERF_MODE=test pnpm exec playwright test',
    );
    expect(runCommands(testCommand('yarn'), 'linux').test).toBe(
      'PW_PERF_MODE=test yarn playwright test',
    );
    expect(runCommands(testCommand('npm'), 'win32').test).toBe(
      'npx cross-env PW_PERF_MODE=test npx playwright test',
    );
  });

  test('04-AC-32 the command comes from the package manager, also with test scripts', () => {
    expect(testCommand('npm')).toBe('npx playwright test');
    expect(testCommand('pnpm')).toBe('pnpm exec playwright test');
    expect(testCommand('yarn')).toBe('yarn playwright test');
    const info = detectProject(
      new Map([
        ['playwright.config.ts', 'export default defineConfig({});'],
        ['package.json', '{"scripts":{"e2e":"playwright test","test:e2e":"playwright test"}}'],
      ]),
    );
    expect(runCommands(testCommand(info.packageManager), 'linux').test).toBe(
      'PW_PERF_MODE=test npx playwright test',
    );
  });
});

describe('check process (04-REQ-58)', () => {
  const base = {
    packageManager: 'npm' as const,
    nodePath: '/usr/bin/node',
    playwrightCli: '/p/node_modules/@playwright/test/cli.js',
    platform: 'linux',
    command: 'npx playwright test',
    shell: '/bin/zsh',
  };

  test('04-AC-38 runs the Playwright CLI through Node without a shell', () => {
    expect(commandSpawn(base)).toEqual({
      ok: true,
      value: { file: '/usr/bin/node', args: [base.playwrightCli, 'test'], shell: false },
    });
    expect(commandSpawn({ ...base, platform: 'win32' })).toEqual({
      ok: true,
      value: { file: '/usr/bin/node', args: [base.playwrightCli, 'test'], shell: false },
    });
  });

  test('04-AC-38 without @playwright/test the command is shown instead', () => {
    const result = commandSpawn({ ...base, playwrightCli: null });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues[0]?.hint).toContain('PW_PERF_MODE=check npx playwright test');
  });
});

describe('runs of the check (04-REQ-58, v4 D4b)', () => {
  test('04-AC-38 thresholds then test, both with 2 passes and the temporary thresholds dir', () => {
    expect(checkRuns('npm run e2e', 'linux', '/tmp/pw-perf-check-x')).toEqual([
      {
        mode: 'thresholds',
        env: {
          PW_PERF_MODE: 'thresholds',
          PW_PERF_PASSES: '2',
          PW_PERF_THRESHOLDS_DIR: '/tmp/pw-perf-check-x',
        },
        shown: 'PW_PERF_MODE=thresholds PW_PERF_PASSES=2 npm run e2e',
      },
      {
        mode: 'test',
        env: {
          PW_PERF_MODE: 'test',
          PW_PERF_PASSES: '2',
          PW_PERF_THRESHOLDS_DIR: '/tmp/pw-perf-check-x',
        },
        shown: 'PW_PERF_MODE=test PW_PERF_PASSES=2 npm run e2e',
      },
    ]);
    expect(checkRuns('npm run e2e', 'win32', 'C:\\t').map((r) => r.shown)).toEqual([
      'npx cross-env PW_PERF_MODE=thresholds PW_PERF_PASSES=2 npm run e2e',
      'npx cross-env PW_PERF_MODE=test PW_PERF_PASSES=2 npm run e2e',
    ]);
  });
});

describe('test command of step 6 (04-REQ-55, 04-REQ-58)', () => {
  const base = {
    packageManager: 'npm' as const,
    nodePath: '/usr/bin/node',
    playwrightCli: '/p/node_modules/@playwright/test/cli.js',
    platform: 'linux',
    command: 'npm run e2e -- --grep "@smoke"',
    shell: '/bin/zsh',
  };

  test('04-AC-52 a typed command is used as typed in every mode', () => {
    expect(runCommands(base.command, 'linux')).toEqual({
      base: base.command,
      test: 'PW_PERF_MODE=test npm run e2e -- --grep "@smoke"',
      thresholds: 'PW_PERF_MODE=thresholds npm run e2e -- --grep "@smoke"',
      check: 'PW_PERF_MODE=check npm run e2e -- --grep "@smoke"',
    });
    expect(runCommands(base.command, 'win32').test).toBe(
      'npx cross-env PW_PERF_MODE=test npm run e2e -- --grep "@smoke"',
    );
  });

  test('04-AC-52 a typed command runs through the user shell: $SHELL, /bin/sh, %ComSpec%', () => {
    expect(commandSpawn(base)).toEqual({
      ok: true,
      value: { file: base.command, args: [], shell: '/bin/zsh' },
    });
    expect(commandSpawn({ ...base, shell: undefined })).toEqual({
      ok: true,
      value: { file: base.command, args: [], shell: '/bin/sh' },
    });
    expect(commandSpawn({ ...base, shell: 'zsh' })).toMatchObject({ value: { shell: '/bin/sh' } });
    expect(commandSpawn({ ...base, platform: 'win32', shell: undefined })).toEqual({
      ok: true,
      value: { file: base.command, args: [], shell: true },
    });
    // Without @playwright/test a typed command still runs: the shell finds its tools.
    expect(commandSpawn({ ...base, playwrightCli: null }).ok).toBe(true);
  });

  test('04-AC-52 PW_PERF_ variables are refused; chains outside quotes are found', () => {
    expect(commandProblem('PW_PERF_MODE=test npx playwright test')).toBe('variable');
    expect(commandProblem('npm run e2e')).toBeNull();
    expect(chainsCommands('npm run seed && npx playwright test')).toBe(true);
    expect(chainsCommands('a; b')).toBe(true);
    expect(chainsCommands('a | tee log')).toBe(true);
    expect(chainsCommands('a || true')).toBe(true);
    expect(chainsCommands('npx playwright test --grep "a && b"')).toBe(false);
    expect(chainsCommands("npx playwright test --grep 'a|b'")).toBe(false);
    expect(chainsCommands('npx playwright test --grep a\\;b')).toBe(false);
    expect(chainsCommands('npm run e2e -- --grep "@smoke"')).toBe(false);
  });
});
