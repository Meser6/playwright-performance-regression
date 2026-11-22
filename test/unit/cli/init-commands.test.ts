// Init wizard: run commands and the check process (04-REQ-55, 04-REQ-58).
import { describe, expect, test } from 'vitest';
import { commandSpawn, runCommands, testCommand } from '../../../src/cli/init/commands.ts';
import { detectProject } from '../../../src/cli/init/detect.ts';

describe('run commands (04-REQ-55)', () => {
  test('04-AC-30 env-prefixed commands for npm, pnpm, yarn and Windows', () => {
    expect(runCommands('npm', 'linux')).toEqual({
      base: 'npx playwright test',
      test: 'PW_PERF_MODE=test npx playwright test',
      thresholds: 'PW_PERF_MODE=thresholds npx playwright test',
      check: 'PW_PERF_MODE=check npx playwright test',
    });
    expect(runCommands('pnpm', 'darwin').test).toBe('PW_PERF_MODE=test pnpm exec playwright test');
    expect(runCommands('yarn', 'linux').test).toBe('PW_PERF_MODE=test yarn playwright test');
    expect(runCommands('npm', 'win32').test).toBe(
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
    expect(runCommands(info.packageManager, 'linux').test).toBe(
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
