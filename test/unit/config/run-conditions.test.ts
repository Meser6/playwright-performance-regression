import type { PlaywrightTestConfig } from '@playwright/test';
import { describe, expect, test } from 'vitest';
import { reporterPathNextTo } from '../../../src/config/reporter-path.ts';
import { planPerfRun } from '../../../src/config/run-conditions.ts';
import type { PerfRunInput } from '../../../src/config/run-conditions.ts';

const REPORTER = '/abs/node_modules/playwright-performance-regression/dist/reporter.js';

function input(overrides: Partial<PerfRunInput> = {}): PerfRunInput {
  return {
    projects: 'auto',
    keepReporters: [],
    repeat: 5,
    reporterPath: REPORTER,
    ...overrides,
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function plan(config: PlaywrightTestConfig, overrides: Partial<PerfRunInput> = {}) {
  const result = planPerfRun(deepFreeze(config), input(overrides));
  if (!result.ok) throw new Error(result.issues.map((i) => i.message).join('\n'));
  return result.value;
}

function issues(config: PlaywrightTestConfig, overrides: Partial<PerfRunInput> = {}) {
  const result = planPerfRun(config, input(overrides));
  if (result.ok) throw new Error('expected issues');
  return result.issues;
}

const browsers: PlaywrightTestConfig = {
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/, teardown: 'cleanup' },
    { name: 'cleanup', testMatch: /.*\.teardown\.ts/ },
    { name: 'chromium', use: { browserName: 'chromium' }, dependencies: ['setup'] },
    { name: 'firefox', use: { browserName: 'firefox' }, dependencies: ['setup'] },
    { name: 'webkit', use: { browserName: 'webkit' }, dependencies: ['setup'] },
  ],
};

describe('planPerfRun: run limits and artifacts', () => {
  test('sets workers 1, retries 0, maxFailures 0, globalTimeout 0 and turns artifacts off (04-REQ-33)', () => {
    const { config } = plan({
      workers: 4,
      retries: 2,
      maxFailures: 3,
      globalTimeout: 60_000,
      timeout: 30_000,
      use: { trace: 'on', video: { mode: 'on' }, screenshot: 'on', baseURL: 'http://x' },
      projects: [{ name: 'chromium', workers: 2, retries: 1, use: { trace: 'retain-on-failure' } }],
    });
    expect(config).toMatchObject({
      workers: 1,
      retries: 0,
      maxFailures: 0,
      globalTimeout: 0,
      timeout: 30_000,
      use: { trace: 'off', video: 'off', screenshot: 'off', baseURL: 'http://x' },
    });
    // Project workers are only a cap below the global workers (V-12 b): left as they are.
    expect(config.projects).toEqual([
      {
        name: 'chromium',
        workers: 2,
        retries: 0,
        repeatEach: 5,
        use: { trace: 'off', video: 'off', screenshot: 'off' },
      },
    ]);
  });

  test('does not mutate the input and gives the same result for the same input (01-REQ-09)', () => {
    const source = structuredClone(browsers);
    const first = plan(browsers);
    expect(browsers).toEqual(source);
    expect(plan(browsers)).toEqual(first);
  });

  test('lists the settings it changed, for the info line of the reporter (01-REQ-37)', () => {
    expect(plan({ workers: 1, projects: [{ name: 'a' }] }).runConditions.overridden).toEqual([]);
    expect(
      plan({
        retries: 1,
        maxFailures: 1,
        globalTimeout: 1,
        use: { video: 'retain-on-failure', screenshot: 'only-on-failure' },
        projects: [{ name: 'a', repeatEach: 2, use: { trace: { mode: 'on' } } }],
      }).runConditions.overridden,
    ).toEqual([
      'workers',
      'retries',
      'repeatEach',
      'maxFailures',
      'globalTimeout',
      'trace',
      'video',
      'screenshot',
    ]);
    // Values equal to what perf mode needs are not changes.
    expect(
      plan({
        workers: 1,
        retries: 0,
        maxFailures: 0,
        use: { trace: 'off', video: { mode: 'off' } },
        projects: [{ name: 'a', repeatEach: 5 }],
      }).runConditions.overridden,
    ).toEqual([]);
  });

  test('warns about slowMo, which slows every browser action', () => {
    const { warnings } = plan({
      use: { launchOptions: { slowMo: 0 } },
      projects: [{ name: 'a', use: { launchOptions: { slowMo: 250 } } }],
    });
    expect(warnings).toEqual([
      expect.objectContaining({
        code: 'CONFIG_SLOW_MO',
        message:
          'use.launchOptions.slowMo: is greater than 0 in project "a"; it slows down every browser action and distorts the measured times',
      }),
    ]);
    expect(plan({ use: { launchOptions: { slowMo: 0 } } }).warnings).toEqual([]);
  });
});

describe('planPerfRun: measured projects (04-REQ-18)', () => {
  test('04-AC-12 auto measures chromium only, keeps its dependencies and teardowns once, removes the rest', () => {
    const result = plan(browsers);
    expect(result.measuredProjects).toEqual(['chromium']);
    expect(result.config.projects?.map((p) => [p.name, p.repeatEach, p.retries])).toEqual([
      ['setup', 1, 0],
      ['cleanup', 1, 0],
      ['chromium', 5, 0],
    ]);
    expect(result.runConditions.removedProjects).toEqual(['firefox', 'webkit']);
  });

  test('04-AC-12 run.projects ["firefox"] measures firefox only', () => {
    const result = plan(browsers, { projects: ['firefox'] });
    expect(result.measuredProjects).toEqual(['firefox']);
    expect(result.config.projects?.map((p) => p.name)).toEqual(['setup', 'cleanup', 'firefox']);
    expect(result.warnings).toEqual([]);
  });

  test('04-AC-09 indirect dependencies and teardowns run once, the measured project N times', () => {
    const result = plan({
      projects: [
        { name: 'auth' },
        { name: 'data', dependencies: ['auth'], teardown: 'data-cleanup' },
        { name: 'data-cleanup' },
        { name: 'measured', dependencies: ['data'], teardown: 'cleanup' },
        { name: 'cleanup' },
        { name: 'other', dependencies: ['data'], use: { browserName: 'webkit' } },
      ],
    });
    expect(result.measuredProjects).toEqual(['measured']);
    expect(
      Object.fromEntries(result.config.projects?.map((p) => [p.name, p.repeatEach]) ?? []),
    ).toEqual({
      auth: 1,
      data: 1,
      'data-cleanup': 1,
      measured: 5,
      cleanup: 1,
    });
    expect(result.runConditions.removedProjects).toEqual(['other']);
  });

  test('auto: effective browser from browserName, then the global one, then defaultBrowserType', () => {
    const result = plan({
      use: { browserName: 'firefox' },
      projects: [
        { name: 'inherits-firefox' },
        { name: 'own-chromium', use: { browserName: 'chromium', channel: 'chrome' } },
        { name: 'device-over-global', use: { defaultBrowserType: 'chromium' } },
      ],
    });
    expect(result.measuredProjects).toEqual(['own-chromium']);
    const devices = plan({
      projects: [
        { name: 'pixel', use: { defaultBrowserType: 'chromium' } },
        { name: 'iphone', use: { defaultBrowserType: 'webkit' } },
        { name: 'edge', use: { channel: 'msedge' } },
      ],
    });
    expect(devices.measuredProjects).toEqual(['pixel', 'edge']);
  });

  test('a config without projects is one default project, measured when it uses Chromium (01-REQ-10)', () => {
    const result = plan({ workers: 2, testDir: 'e2e' });
    expect(result.measuredProjects).toEqual(['']);
    expect(result.config).toMatchObject({ testDir: 'e2e', workers: 1, repeatEach: 5, retries: 0 });
    expect(result.config.projects).toBeUndefined();
    expect(result.runConditions.removedProjects).toEqual([]);
  });

  test('03-AC-03 CONFIG_NO_MEASURED_PROJECT when auto finds no Chromium project', () => {
    for (const config of [
      { use: { browserName: 'webkit' as const } },
      { projects: [{ name: 'firefox', use: { browserName: 'firefox' as const } }] },
      { projects: [] },
    ]) {
      expect(issues(config)).toEqual([
        expect.objectContaining({
          code: 'CONFIG_NO_MEASURED_PROJECT',
          path: 'run.projects',
          message:
            'run.projects: no project is measured; "auto" measures Chromium projects that are not a dependency or teardown of another project, and the Playwright config has none',
        }),
      ]);
    }
  });

  test('03-AC-03 CONFIG_UNKNOWN_PROJECT for each listed name the config does not have', () => {
    expect(issues(browsers, { projects: ['chromium', 'chrome', 'edge'] })).toEqual([
      expect.objectContaining({
        code: 'CONFIG_UNKNOWN_PROJECT',
        path: 'run.projects',
        message:
          'run.projects: project "chrome" is not in the Playwright config; its projects are "setup", "cleanup", "chromium", "firefox", "webkit"',
      }),
      expect.objectContaining({ code: 'CONFIG_UNKNOWN_PROJECT' }),
    ]);
    expect(issues({}, { projects: ['chromium'] })[0]?.message).toBe(
      'run.projects: project "chromium" is not in the Playwright config; it has no projects, only the default one',
    );
  });

  test('03-AC-11 two engines give CONFIG_MULTIPLE_ENGINES; a listed dependency of a listed project is repeated', () => {
    const result = plan(browsers, { projects: ['chromium', 'firefox', 'setup'] });
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'CONFIG_MULTIPLE_ENGINES',
        path: 'run.projects',
        message:
          'run.projects: the measured projects use more than one browser engine (chromium, firefox); their samples go to the same keys',
      }),
    ]);
    expect(result.measuredProjects).toEqual(['setup', 'chromium', 'firefox']);
    expect(result.config.projects?.find((p) => p.name === 'setup')?.repeatEach).toBe(5);
    expect(result.config.projects?.find((p) => p.name === 'cleanup')?.repeatEach).toBe(1);
  });
});

describe('planPerfRun: reporters (04-REQ-32)', () => {
  test('04-AC-13 keeps console reporters and run.keepReporters, removes the rest, adds the package reporter', () => {
    const result = plan(
      {
        reporter: [
          ['line'],
          ['junit', { outputFile: 'junit.xml' }],
          ['html', { open: 'always', outputFolder: 'report' }],
          ['./reporters/slack.ts', { channel: 'qa' }],
          ['github'],
        ],
      },
      { keepReporters: ['html'] },
    );
    expect(result.config.reporter).toEqual([
      ['line'],
      ['html', { open: 'never', outputFolder: 'report' }],
      ['github'],
      [REPORTER],
    ]);
    expect(result.runConditions.removedReporters).toEqual(['junit', './reporters/slack.ts']);
    expect(result.runConditions.replacedReporters).toEqual([]);
    expect(
      plan({ reporter: [['junit', { outputFile: 'junit.xml' }]] }, { keepReporters: ['junit'] })
        .config.reporter,
    ).toEqual([['dot'], ['junit', { outputFile: 'junit.xml' }], [REPORTER]]);
  });

  test('04-AC-26 list becomes dot, two dots become one, run.keepReporters keeps list', () => {
    const result = plan({ reporter: [['list', { printSteps: true }], ['junit']] });
    expect(result.config.reporter).toEqual([['dot'], [REPORTER]]);
    expect(result.runConditions.removedReporters).toEqual(['junit']);
    expect(result.runConditions.replacedReporters).toEqual(['list']);
    expect(plan({ reporter: 'list' }).config.reporter).toEqual([['dot'], [REPORTER]]);
    expect(plan({ reporter: [['list'], ['dot']] }).config.reporter).toEqual([['dot'], [REPORTER]]);
    expect(plan({ reporter: [['dot'], ['list']] }).config.reporter).toEqual([['dot'], [REPORTER]]);
    const kept = plan({ reporter: [['list']] }, { keepReporters: ['list'] });
    expect(kept.config.reporter).toEqual([['list'], [REPORTER]]);
    expect(kept.runConditions.replacedReporters).toEqual([]);
  });

  test('04-AC-26 adds dot when no console reporter is left, on CI and locally', () => {
    // The plan does not depend on CI: dot also locally.
    expect(plan({ reporter: 'html' }).config.reporter).toEqual([['dot'], [REPORTER]]);
    // Without a reporter Playwright would pick list locally; the run gets dot, nothing is removed.
    const result = plan({});
    expect(result.config.reporter).toEqual([['dot'], [REPORTER]]);
    expect(result.runConditions.removedReporters).toEqual([]);
    expect(result.runConditions.replacedReporters).toEqual([]);
    expect(plan({ reporter: 'line' }).config.reporter).toEqual([['line'], [REPORTER]]);
  });

  test('a package reporter already in the config is kept once', () => {
    expect(
      plan({ reporter: [['dot'], ['playwright-performance-regression/reporter']] }).config.reporter,
    ).toEqual([['dot'], ['playwright-performance-regression/reporter']]);
    expect(plan({ reporter: [['dot'], [REPORTER]] }).config.reporter).toEqual([
      ['dot'],
      [REPORTER],
    ]);
  });
});

describe('reporter entry path', () => {
  test('is the reporter entry point next to the config entry point, with its extension', () => {
    expect(reporterPathNextTo('/p/node_modules/pkg/dist/config.js')).toBe(
      '/p/node_modules/pkg/dist/reporter.js',
    );
    expect(reporterPathNextTo('/p/dist/config.cjs')).toBe('/p/dist/reporter.cjs');
    expect(reporterPathNextTo('C:\\a b\\dist\\config.cjs')).toBe('C:\\a b\\dist\\reporter.cjs');
  });
});
