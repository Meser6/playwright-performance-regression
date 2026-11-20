import { defineConfig } from '@playwright/test';
import type { PlaywrightTestConfig } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, expectTypeOf, test, vi } from 'vitest';
import { definePerfConfig, withPerf } from '../../../src/config/index.ts';
import * as configEntry from '../../../src/entries/config.ts';
import { ConfigError } from '../../../src/core/types/index.ts';
import { REGISTRY_KEY, getRegistered } from '../../../src/registry/index.ts';
import packageJson from '../../../package.json' with { type: 'json' };

const EMPTY: PlaywrightTestConfig = {};

function clearRegistry(): void {
  Reflect.deleteProperty(globalThis, REGISTRY_KEY);
  Reflect.deleteProperty(
    globalThis,
    Symbol.for('playwright-performance-regression.mainProcessSetup'),
  );
}

function thrown(run: () => unknown): ConfigError {
  try {
    run();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a ConfigError');
}

beforeEach(() => {
  clearRegistry();
  for (const name of ['PW_PERF_MODE', 'PW_PERF_REPEAT', 'PW_PERF_ENV', 'PW_PERF_PRUNE', 'CI']) {
    vi.stubEnv(name, undefined);
  }
  // As in a worker: the main-process setup of the environment mode is tested on its own below.
  vi.stubEnv('TEST_WORKER_INDEX', '0');
  vi.stubEnv('PW_PERF_RUN_ID', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearRegistry();
});

describe('withPerf outside perf mode (P-02)', () => {
  test('01-AC-03 returns the same config object, does not validate and leaves the registry empty', () => {
    const config = { workers: 4, reporter: 'html' as const };
    // An invalid package config is not even looked at (01-REQ-08).
    expect(withPerf(config, { run: { repeat: { test: 0 } }, nope: 1 } as never)).toBe(config);
    expect(withPerf(config)).toBe(config);
    expect(config).toEqual({ workers: 4, reporter: 'html' });
    expect(getRegistered()).toBeUndefined();
    vi.stubEnv('PW_PERF_MODE', '');
    expect(withPerf(config)).toBe(config);
  });
});

describe('withPerf in perf mode', () => {
  beforeEach(() => {
    vi.stubEnv('PW_PERF_MODE', 'test');
  });

  test('returns a modified copy and registers the resolved config', () => {
    const config = defineConfig({
      workers: 4,
      projects: [
        { name: 'setup' },
        { name: 'chromium', dependencies: ['setup'] },
        { name: 'firefox', use: { browserName: 'firefox' } },
      ],
    });
    const result = withPerf(config, definePerfConfig({ run: { repeat: { test: 3 } } }));
    expect(result).not.toBe(config);
    expect(config.workers).toBe(4);
    expect(result.workers).toBe(1);
    expect(result.projects?.map((p) => [p.name, p.repeatEach])).toEqual([
      ['setup', 1],
      ['chromium', 3],
    ]);
    const reporter = result.reporter as [string][];
    expect(reporter[0]).toEqual(['dot']);
    expect(reporter[1]?.[0]).toMatch(/[\\/]reporter\.(?:c?js|ts)$/);

    const state = getRegistered();
    expect(state?.mode).toEqual({ mode: 'test' });
    expect(state?.measuredProjects).toEqual(['chromium']);
    expect(state?.packageVersion).toBe(packageJson.version);
    expect(state?.config.run.repeat.test).toBe(3);
    expect(state?.snapshot.run.repeat.test).toBe(3);
    expect(state?.runConditions).toEqual({
      overridden: ['workers'],
      removedProjects: ['firefox'],
      removedReporters: [],
      replacedReporters: [],
    });
  });

  test('environment overrides win over the package config (01-REQ-29)', () => {
    vi.stubEnv('PW_PERF_MODE', 'thresholds');
    vi.stubEnv('PW_PERF_REPEAT', '7');
    vi.stubEnv('PW_PERF_ENV', 'qa');
    const result = withPerf(EMPTY, { run: { repeat: { thresholds: 2 }, env: 'staging' } });
    expect(result.repeatEach).toBe(7);
    expect(getRegistered()?.config.run).toMatchObject({ env: 'qa', repeat: { thresholds: 7 } });
    expect(getRegistered()?.mode).toEqual({ mode: 'thresholds', repeat: 7, env: 'qa' });
  });

  test('uses run.repeat of the current mode and the dot reporter on CI', () => {
    vi.stubEnv('PW_PERF_MODE', 'thresholds');
    vi.stubEnv('CI', 'true');
    const result = withPerf(EMPTY);
    expect(result.repeatEach).toBe(10);
    expect((result.reporter as [string][])[0]).toEqual(['dot']);
  });

  test('keeps resolveConfig and run condition warnings in the registry for the reporter', () => {
    withPerf(
      { use: { launchOptions: { slowMo: 50 } } },
      { checks: { time: { percentile: { level: 'p99' } } } },
    );
    expect(getRegistered()?.warnings.map((w) => w.code)).toEqual([
      'CONFIG_PERCENTILE_IS_P99',
      'CONFIG_SLOW_MO',
    ]);
  });

  test('03-AC-10 a plain object gives the same result as a defineConfig() object', () => {
    const plain: PlaywrightTestConfig = {
      testDir: 'e2e',
      retries: 2,
      reporter: [['list'], ['junit', { outputFile: 'j.xml' }]],
      use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
      projects: [{ name: 'setup' }, { name: 'chromium', dependencies: ['setup'] }],
    };
    const fromPlain = withPerf(structuredClone(plain));
    const plainState = getRegistered();
    clearRegistry();
    const fromDefine = withPerf(defineConfig(structuredClone(plain)));
    expect(fromDefine).toEqual(expect.objectContaining(fromPlain));
    expect(getRegistered()).toEqual(plainState);
  });

  test('throws ConfigError with MODE_INVALID_VALUE for invalid mode variables (01-REQ-27)', () => {
    vi.stubEnv('PW_PERF_MODE', 'perf');
    vi.stubEnv('PW_PERF_REPEAT', 'many');
    const error = thrown(() => withPerf(EMPTY));
    expect(error.issues.map((i) => i.code)).toEqual(['MODE_INVALID_VALUE', 'MODE_INVALID_VALUE']);
    expect(error.message).toContain(
      '  - PW_PERF_MODE: expected "test" or "thresholds", got "perf"',
    );
    expect(getRegistered()).toBeUndefined();
  });

  test('throws ConfigError listing every package config problem before tests start', () => {
    const error = thrown(() =>
      withPerf(EMPTY, { gate: { tolerance: '5' }, measure: { exclud: [] } } as never),
    );
    expect(error.issues.map((i) => i.code)).toEqual([
      'CONFIG_INVALID_VALUE',
      'CONFIG_UNKNOWN_OPTION',
    ]);
    expect(
      error.message.startsWith(
        'playwright-performance-regression: invalid configuration (2 problems)',
      ),
    ).toBe(true);
    expect(getRegistered()).toBeUndefined();
  });

  test('throws ConfigError for project problems (03-REQ-11)', () => {
    expect(thrown(() => withPerf({ use: { browserName: 'webkit' } })).issues[0]?.code).toBe(
      'CONFIG_NO_MEASURED_PROJECT',
    );
    expect(
      thrown(() => withPerf({ projects: [{ name: 'a' }] }, { run: { projects: ['b'] } })).issues[0]
        ?.code,
    ).toBe('CONFIG_UNKNOWN_PROJECT');
  });

  test('a repeat override above the maximum is a config error', () => {
    vi.stubEnv('PW_PERF_REPEAT', '1001');
    expect(thrown(() => withPerf(EMPTY)).issues[0]?.code).toBe('CONFIG_INVALID_VALUE');
  });
});

describe('the config entry point', () => {
  test('exports withPerf and definePerfConfig with the config type kept', () => {
    expect(configEntry.withPerf).toBe(withPerf);
    expect(configEntry.definePerfConfig({ run: { repeat: { test: 2 } } })).toEqual({
      run: { repeat: { test: 2 } },
    });
    const typed = defineConfig<{ account: string }>({ use: { account: 'a' } });
    expectTypeOf(withPerf(typed)).toEqualTypeOf(typed);
  });
});

describe('main process of the environment mode (04-REQ-60, 04-REQ-61)', () => {
  const argv = process.argv;
  beforeEach(() => {
    vi.stubEnv('PW_PERF_MODE', 'test');
    vi.stubEnv('TEST_WORKER_INDEX', undefined);
  });
  afterEach(() => {
    process.argv = argv;
  });

  test('04-AC-40 sets PW_PERF_RUN_ID for the workers once, and not through the CLI', () => {
    process.argv = ['node', 'playwright', 'test'];
    withPerf(EMPTY);
    const runId = process.env.PW_PERF_RUN_ID;
    expect(runId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-[0-9a-f]{4}$/u);
    expect(getRegistered()?.mode.runId).toBe(runId);
    withPerf(EMPTY);
    expect(process.env.PW_PERF_RUN_ID).toBe(runId);

    clearRegistry();
    vi.stubEnv('PW_PERF_RUN_ID', undefined);
    vi.stubEnv('PW_PERF_OUTCOME_FILE', '/tmp/x.json');
    withPerf(EMPTY);
    expect(process.env.PW_PERF_RUN_ID).toBeUndefined();
  });

  test('04-AC-40 RUN_REPORTER_FLAG on stderr only, RUN_UNSUPPORTED_FLAG also in the report', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      process.argv = ['node', 'playwright', 'test', '--reporter=junit', '--ui'];
      withPerf(EMPTY);
      const text = write.mock.calls.map((c) => String(c[0])).join('');
      expect(text).toContain('RUN_REPORTER_FLAG');
      expect(text).toContain('RUN_UNSUPPORTED_FLAG');
      expect(getRegistered()?.warnings.map((w) => w.code)).toEqual(['RUN_UNSUPPORTED_FLAG']);

      clearRegistry();
      write.mockClear();
      process.argv = [
        'node',
        'playwright',
        'test',
        '--reporter',
        'line,playwright-performance-regression/reporter',
      ];
      withPerf(EMPTY);
      expect(write.mock.calls.map((c) => String(c[0])).join('')).not.toContain('RUN_REPORTER_FLAG');
    } finally {
      write.mockRestore();
    }
  });
});
