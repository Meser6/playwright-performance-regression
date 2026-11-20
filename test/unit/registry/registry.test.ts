import { afterEach, describe, expect, test } from 'vitest';
import { resolveConfig } from '../../../src/core/config/index.ts';
import type { PerfConfigInput } from '../../../src/core/config/index.ts';
import {
  REGISTRY_KEY,
  getRegistered,
  notWrappedWarning,
  setRegistered,
  trackedContexts,
  wrappedTests,
} from '../../../src/registry/index.ts';
import type { RegisteredState } from '../../../src/registry/index.ts';

function state(input: PerfConfigInput = {}, measuredProjects = ['chromium']): RegisteredState {
  const resolved = resolveConfig(input, {});
  if (!resolved.ok) throw new Error('invalid test config');
  return {
    config: resolved.value.config,
    snapshot: resolved.value.snapshot,
    mode: { mode: 'test' },
    packageVersion: '0.0.0',
    measuredProjects,
    runConditions: {
      overridden: [],
      removedProjects: [],
      removedReporters: [],
      replacedReporters: [],
    },
    warnings: [],
  };
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, REGISTRY_KEY);
});

describe('process registry', () => {
  test('lives in globalThis under Symbol.for("pw-perf.registry")', () => {
    expect(REGISTRY_KEY).toBe(Symbol.for('pw-perf.registry'));
    expect(getRegistered()).toBeUndefined();
    const first = state();
    setRegistered(first);
    expect(getRegistered()).toBe(first);
    const slot = (globalThis as Record<symbol, { state?: unknown }>)[REGISTRY_KEY];
    expect(slot?.state).toBe(first);
  });

  test('a copy of the module loaded separately (ESM and CJS builds) shares the slot', async () => {
    setRegistered(state());
    // A second module instance stands in for the other build of the package (V-01).
    const url = new URL('../../../src/registry/index.ts', import.meta.url);
    const copy = (await import(/* @vite-ignore */ `${url.href}?copy`)) as {
      getRegistered: typeof getRegistered;
    };
    expect(copy.getRegistered).not.toBe(getRegistered);
    expect(copy.getRegistered()).toBe(getRegistered());
  });

  test('writing the same config again changes nothing and gives no warning (01-REQ-06)', () => {
    const first = state({ run: { repeat: { test: 3 } } });
    expect(setRegistered(first)).toBeUndefined();
    const again = state({ run: { repeat: { test: 3 } } });
    expect(setRegistered(again)).toBeUndefined();
    expect(getRegistered()).toBe(first);
    expect(first.warnings).toEqual([]);
  });

  test('03-AC-03 CONFIG_CHANGED_IN_PROCESS when another config replaces the registered one', () => {
    setRegistered(state({ run: { repeat: { test: 3 } } }));
    const second = state({ run: { repeat: { test: 4 } } });
    const warning = setRegistered(second);
    expect(warning).toEqual(
      expect.objectContaining({
        code: 'CONFIG_CHANGED_IN_PROCESS',
        message:
          'config: withPerf() was called again in this process with a different package config; the last one is used',
      }),
    );
    expect(getRegistered()).toBe(second);
    expect(second.warnings).toEqual([warning]);
    // Different measured projects also count as a different registration.
    expect(setRegistered(state({ run: { repeat: { test: 4 } } }, ['other']))?.code).toBe(
      'CONFIG_CHANGED_IN_PROCESS',
    );
  });

  test('03-AC-03 NOT_WRAPPED_WITH_PERF tells how to apply withPerf()', () => {
    expect(notWrappedWarning()).toEqual({
      code: 'NOT_WRAPPED_WITH_PERF',
      message:
        'config: withPerf() was not applied to the Playwright config in this process, so the default package config is used',
      hint: 'Wrap the Playwright config: export default withPerf(defineConfig({ ... }), perfConfig) with withPerf from "playwright-performance-regression/config".',
    });
  });

  test('keeps the weak set of wrapped test objects and the set of tracked contexts', () => {
    const tests = wrappedTests();
    const marker = {};
    tests.add(marker);
    expect(wrappedTests()).toBe(tests);
    expect(wrappedTests().has(marker)).toBe(true);
    const contexts = trackedContexts();
    contexts.add(marker);
    expect(trackedContexts().has(marker)).toBe(true);
    // The sets live next to the state: registering a config keeps them.
    setRegistered(state());
    expect(wrappedTests().has(marker)).toBe(true);
  });
});
