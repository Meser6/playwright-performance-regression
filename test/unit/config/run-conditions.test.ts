import type { PlaywrightTestConfig } from '@playwright/test';
import { describe, expect, test } from 'vitest';
import { reporterPathNextTo } from '../../../src/config/reporter-path.ts';
import { planPerfRun } from '../../../src/config/run-conditions.ts';
import type { PerfRunInput } from '../../../src/config/run-conditions.ts';

const REPORTER = '/abs/node_modules/playwright-performance-regression/dist/reporter.js';

function input(overrides: Partial<PerfRunInput> = {}): PerfRunInput {
  return {
    keepReporters: [],
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
  test('04-AC-16 sets workers 1, repeatEach 1, maxFailures 0, globalTimeout 0, keeps retries and turns artifacts off (04-REQ-33, D-38)', () => {
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
      retries: 2,
      repeatEach: 1,
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
        retries: 1,
        repeatEach: 1,
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
      'repeatEach',
      'maxFailures',
      'globalTimeout',
      'trace',
      'video',
      'screenshot',
    ]);
    // Values equal to what perf mode needs are not changes; retries stay from the config (D-38).
    expect(
      plan({
        workers: 1,
        retries: 3,
        maxFailures: 0,
        use: { trace: 'off', video: { mode: 'off' } },
        projects: [{ name: 'a', repeatEach: 1 }],
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

describe('planPerfRun: run.overrideSlowMo (03-REQ-27, D-45)', () => {
  const slow: PlaywrightTestConfig = {
    use: { launchOptions: { slowMo: 100, headless: true } },
    projects: [
      { name: 'setup', testMatch: /.*\.setup\.ts/ },
      { name: 'E2E', dependencies: ['setup'] },
      {
        name: 'own',
        use: { launchOptions: { slowMo: 50, args: ['--a'] } },
        dependencies: ['setup'],
      },
    ],
  };

  test('03-AC-19 true sets slowMo to 0 in every measured project and lists it as overridden', () => {
    const result = plan(slow, { overrideSlowMo: true });
    const use = (name: string) => result.config.projects?.find((p) => p.name === name)?.use;
    expect(use('E2E')?.launchOptions).toEqual({ slowMo: 0, headless: true });
    expect(use('own')?.launchOptions).toEqual({ slowMo: 0, args: ['--a'] });
    expect(use('setup')?.launchOptions).toBeUndefined();
    expect(result.config.use?.launchOptions).toEqual({ slowMo: 100, headless: true });
    expect(result.runConditions.overridden).toContain('slowMo');
    expect(result.warnings).toEqual([]);
  });

  test('03-AC-19 true without projects sets slowMo to 0 in the global use', () => {
    const result = plan({ use: { launchOptions: { slowMo: 100 } } }, { overrideSlowMo: true });
    expect(result.config.use?.launchOptions).toEqual({ slowMo: 0 });
    expect(result.runConditions.overridden).toContain('slowMo');
  });

  test('03-AC-19 true without a positive slowMo does not list slowMo', () => {
    const result = plan(
      {
        use: { launchOptions: { slowMo: 100 } },
        projects: [{ name: 'a', use: { launchOptions: {} } }],
      },
      { overrideSlowMo: true },
    );
    expect(result.config.projects?.[0]?.use?.launchOptions).toEqual({ slowMo: 0 });
    expect(result.runConditions.overridden).not.toContain('slowMo');
    expect(plan({}, { overrideSlowMo: true }).runConditions.overridden).not.toContain('slowMo');
  });

  test('03-AC-19 false keeps slowMo and the warning hints at run.overrideSlowMo', () => {
    const result = plan(slow, { overrideSlowMo: false });
    expect(
      result.config.projects?.find((p) => p.name === 'E2E')?.use?.launchOptions,
    ).toBeUndefined();
    expect(result.config.use?.launchOptions).toEqual({ slowMo: 100, headless: true });
    expect(result.runConditions.overridden).not.toContain('slowMo');
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: 'CONFIG_SLOW_MO',
        hint: 'Remove slowMo from the Playwright config for the measurement run, or set run.overrideSlowMo: true in the package config.',
      }),
    ]);
  });
});

describe('planPerfRun: measured projects (04-REQ-18, D-44)', () => {
  test('04-AC-12 every project but setup and teardown projects may be measured, whatever the browser; no project is removed', () => {
    const result = plan(browsers);
    expect(result.measuredProjects).toEqual(['chromium', 'firefox', 'webkit']);
    expect(result.config.projects?.map((p) => [p.name, p.repeatEach])).toEqual([
      ['setup', 1],
      ['cleanup', 1],
      ['chromium', 1],
      ['firefox', 1],
      ['webkit', 1],
    ]);
    expect(result.warnings).toEqual([]);
  });

  test('04-AC-09 direct and indirect dependencies and teardowns are not measured; every project runs once per pass (D-39)', () => {
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
    expect(result.measuredProjects).toEqual(['measured', 'other']);
    expect(
      Object.fromEntries(result.config.projects?.map((p) => [p.name, p.repeatEach]) ?? []),
    ).toEqual({
      auth: 1,
      data: 1,
      'data-cleanup': 1,
      measured: 1,
      cleanup: 1,
      other: 1,
    });
  });

  test('a config without projects is one default project, always measurable (01-REQ-10)', () => {
    const result = plan({ workers: 2, testDir: 'e2e', use: { browserName: 'webkit' } });
    expect(result.measuredProjects).toEqual(['']);
    expect(result.config).toMatchObject({ testDir: 'e2e', workers: 1, repeatEach: 1 });
    expect(result.config.retries).toBeUndefined();
    expect(result.config.projects).toBeUndefined();
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

describe('run.grep (03-REQ-25)', () => {
  const projects: PlaywrightTestConfig = {
    projects: [
      { name: 'setup', testMatch: /.*\.setup\.ts/ },
      { name: 'E2E', dependencies: ['setup'] },
      { name: 'smoke', dependencies: ['setup'], grep: /@smoke/ },
    ],
  };

  test('03-AC-18 measured projects get run.grep, setup projects run in full', () => {
    const result = plan(projects, { grep: '@perf' });
    const byName = new Map(result.config.projects?.map((p) => [p.name, p]));
    expect(byName.get('setup')?.grep).toBeUndefined();
    const e2e = byName.get('E2E')?.grep as RegExp;
    expect(e2e).toEqual(/@perf/i);
    expect(e2e.test('checkout @PERF')).toBe(true);
    const smoke = byName.get('smoke')?.grep as RegExp;
    expect(smoke.test('checkout @perf @smoke')).toBe(true);
    expect(smoke.test('checkout @smoke @perf')).toBe(true);
    expect(smoke.test('checkout @perf')).toBe(false);
    expect(smoke.test('checkout @smoke')).toBe(false);
  });

  test('03-AC-18 without projects the config grep is combined; without run.grep nothing changes', () => {
    const single = plan({ grep: [/@a/, /@b/] }, { grep: '@perf' }).config.grep as RegExp;
    expect(single.test('x @b @perf')).toBe(true);
    expect(single.test('x @perf')).toBe(false);
    expect(plan({}, { grep: '@perf' }).config.grep).toEqual(/@perf/i);
    expect(plan(projects).config.projects?.[1]?.grep).toBeUndefined();
    expect(plan({}).config.grep).toBeUndefined();
  });
});
