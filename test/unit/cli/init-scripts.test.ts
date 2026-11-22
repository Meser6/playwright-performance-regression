// Init wizard: test scripts, run commands and the check process (04-REQ-54 – 04-REQ-58).
import { describe, expect, test } from 'vitest';
import { defaultAnswers } from '../../../src/cli/init/defaults.ts';
import { detectProject } from '../../../src/cli/init/detect.ts';
import {
  breakingFlags,
  commandSpawn,
  defaultScript,
  detectTestScripts,
  runCommands,
  testCommand,
} from '../../../src/cli/init/scripts.ts';
import type { DetectedScript } from '../../../src/cli/init/scripts.ts';

const detect = (scripts: Record<string, string>): DetectedScript[] =>
  detectTestScripts(new Map(Object.entries(scripts)));
const names = (scripts: Record<string, string>): string[] => detect(scripts).map((s) => s.name);

describe('test scripts (04-REQ-54)', () => {
  test('04-AC-29 recognized scripts', () => {
    expect(
      names({
        a: 'playwright test',
        b: 'npx playwright test',
        c: 'pnpm exec playwright test',
        d: 'yarn playwright test',
        e: 'A=1 B=2 npx playwright test -g x',
        f: 'cross-env A=1 playwright test',
        g: 'dotenv -e .env.qa -- playwright test',
        h: 'npm run prep && npm run a',
        test: 'playwright test --project=E2E',
        i: 'npm test',
        prep: 'node seed.js',
      }),
    ).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'test', 'i']);
  });

  test('04-AC-29 not recognized: --list, pw-perf, PW_PERF_MODE, chains of chains, hooks, two segments', () => {
    expect(
      names({
        list: 'playwright test --list',
        wrapped: 'pw-perf test',
        env: 'PW_PERF_MODE=test npm run e2e',
        e2e: 'npm run b',
        b: 'npm run direct',
        direct: 'playwright test',
        pretest: 'playwright test',
        test: 'node x.js',
        two: 'playwright test a && playwright test b',
      }),
    ).toEqual(['b', 'direct']);
    const [complex] = detect({ x: 'x | tee y && playwright test' });
    expect(complex?.complex).toBe(true);
  });

  test('flags, projects, test selection and later segments of the Playwright segment', () => {
    const [qa] = detect({
      'e2e:qa':
        'npm run prepare-env:qa && APP=shop TYPE=e2e INSTANCE=QA npx playwright test --project=E2E --grep "@tier_1|@tier_2" && node upload.js',
      'prepare-env:qa': 'node env.js qa',
    });
    expect(qa).toMatchObject({
      name: 'e2e:qa',
      complex: false,
      chainTarget: null,
      projectFlags: ['E2E'],
      selectsTests: true,
      laterSegments: ['node upload.js'],
    });
    expect(qa?.playwrightFlags).toEqual(['--project=E2E', '--grep', '@tier_1|@tier_2']);
    const [chain] = detect({ e2e: 'npm run base -- --project smoke', base: 'playwright test' });
    expect(chain).toMatchObject({
      chainTarget: 'base',
      projectFlags: ['smoke'],
      selectsTests: false,
    });
  });

  test('the default script: the only one, else test:e2e, e2e, test, else plain', () => {
    expect(defaultScript(detect({ x: 'playwright test' }))).toBe('x');
    expect(defaultScript(detect({ a: 'playwright test', e2e: 'playwright test' }))).toBe('e2e');
    expect(defaultScript(detect({ a: 'playwright test', b: 'playwright test' }))).toBeNull();
    expect(defaultScript([])).toBeNull();
  });

  test('04-AC-31 flags that break a measurement run are listed once each, the script unchanged', () => {
    const [script] = detect({
      e2e: 'playwright test --reporter=list,allure-playwright --workers=4 --ui',
    });
    expect(breakingFlags(script as DetectedScript)).toEqual([
      { flag: '--reporter', effect: 'reporter' },
      { flag: '--workers', effect: 'conditions' },
      { flag: '--ui', effect: 'interactive' },
    ]);
    const [plain] = detect({ e2e: 'playwright test --retries 2' });
    expect(breakingFlags(plain as DetectedScript)).toEqual([]);
  });
});

describe('run commands (04-REQ-55)', () => {
  test('04-AC-30 env-prefixed commands for npm, pnpm, yarn and Windows', () => {
    expect(runCommands('e2e:qa', 'npm', 'linux')).toEqual({
      base: 'npm run e2e:qa',
      test: 'PW_PERF_MODE=test npm run e2e:qa',
      thresholds: 'PW_PERF_MODE=thresholds npm run e2e:qa',
      check: 'PW_PERF_MODE=check npm run e2e:qa',
    });
    expect(runCommands('e2e:qa', 'pnpm', 'darwin').test).toBe('PW_PERF_MODE=test pnpm run e2e:qa');
    expect(runCommands('e2e:qa', 'yarn', 'linux').test).toBe('PW_PERF_MODE=test yarn e2e:qa');
    expect(runCommands('e2e:qa', 'npm', 'win32').test).toBe(
      'npx cross-env PW_PERF_MODE=test npm run e2e:qa',
    );
  });

  test('04-AC-32 plain playwright test without scripts; --yes takes it', () => {
    expect(testCommand(null, 'npm')).toBe('npx playwright test');
    expect(testCommand(null, 'pnpm')).toBe('pnpm exec playwright test');
    expect(testCommand(null, 'yarn')).toBe('yarn playwright test');
    const info = detectProject(
      new Map([
        ['playwright.config.ts', 'export default defineConfig({});'],
        ['package.json', '{"scripts":{"lint":"eslint ."}}'],
      ]),
    );
    expect(info.testScripts).toEqual([]);
    expect(defaultAnswers(info).script).toBeNull();
    expect(runCommands(null, 'npm', 'linux').test).toBe('PW_PERF_MODE=test npx playwright test');
  });
});

describe('check process (04-REQ-58)', () => {
  const base = {
    packageManager: 'npm' as const,
    nodePath: '/usr/bin/node',
    playwrightCli: '/p/node_modules/@playwright/test/cli.js',
  };

  test('04-AC-38 npm_execpath with npm-cli.js runs through Node without a shell', () => {
    expect(
      commandSpawn({
        ...base,
        script: 'e2e:qa',
        npmExecPath: '/usr/lib/node_modules/npm/bin/npm-cli.js',
        platform: 'linux',
      }),
    ).toEqual({
      ok: true,
      value: {
        file: '/usr/bin/node',
        args: ['/usr/lib/node_modules/npm/bin/npm-cli.js', 'run', 'e2e:qa'],
        shell: false,
      },
    });
  });

  test('04-AC-38 Windows without npm_execpath uses a shell only for a safe script name', () => {
    expect(commandSpawn({ ...base, script: 'e2e:qa', platform: 'win32' })).toEqual({
      ok: true,
      value: { file: 'npm', args: ['run', 'e2e:qa'], shell: true },
    });
    const unsafe = commandSpawn({ ...base, script: 'a&b', platform: 'win32' });
    expect(unsafe.ok).toBe(false);
    expect(commandSpawn({ ...base, script: 'e2e', platform: 'linux' })).toEqual({
      ok: true,
      value: { file: 'npm', args: ['run', 'e2e'], shell: false },
    });
  });

  test('plain playwright test runs the Playwright CLI through Node', () => {
    expect(commandSpawn({ ...base, script: null, platform: 'linux' })).toEqual({
      ok: true,
      value: { file: '/usr/bin/node', args: [base.playwrightCli, 'test'], shell: false },
    });
    expect(commandSpawn({ ...base, script: null, playwrightCli: null, platform: 'linux' }).ok).toBe(
      false,
    );
  });
});
