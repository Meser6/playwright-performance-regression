import type { BrowserContext, TestInfo } from '@playwright/test';
import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest';
import { trackContext, withPerfFixtures } from '../../../src/collector/fixtures.ts';
import type { PerfApi } from '../../../src/collector/perf-api.ts';
import { resolveConfig } from '../../../src/core/config/index.ts';
import { ConfigError, SAMPLES_ATTACHMENT_NAME } from '../../../src/core/types/index.ts';
import {
  REGISTRY_KEY,
  activeCollector,
  setRegistered,
  trackedContexts,
} from '../../../src/registry/index.ts';
import { FakeContext, FakeRequest, finish } from './fakes.ts';

/** A stand-in for a Playwright test object: extend() records the fixtures. */
interface FakeTest {
  fixtures: Record<string, unknown>[];
  extend(fixtures: Record<string, unknown>): FakeTest;
}

function fakeTest(fixtures: Record<string, unknown>[] = []): FakeTest {
  return {
    fixtures,
    extend(more) {
      return fakeTest([...this.fixtures, more]);
    },
  };
}

const wrap = (base: FakeTest): FakeTest =>
  withPerfFixtures(
    base as unknown as Parameters<typeof withPerfFixtures>[0],
  ) as unknown as FakeTest;

type FixtureFn = (
  args: Record<string, unknown>,
  use: (value: unknown) => Promise<void>,
  info: TestInfo,
) => Promise<void>;

function fixture(t: FakeTest, name: string): FixtureFn {
  const value = t.fixtures.at(-1)?.[name];
  return (Array.isArray(value) ? value[0] : value) as FixtureFn;
}

function register(measuredProjects: string[]): void {
  const resolved = resolveConfig({ measure: { pendingTimeoutMs: 0 } }, {});
  if (!resolved.ok) throw new Error('invalid test config');
  setRegistered({
    config: resolved.value.config,
    snapshot: resolved.value.snapshot,
    mode: { mode: 'test' },
    packageVersion: '0.0.0',
    measuredProjects,
    runConditions: {
      overridden: [],
      removedReporters: [],
      replacedReporters: [],
    },
    warnings: [],
  });
}

function testInfo(project: string) {
  const attach = vi.fn((_name: string, _options: { body: string; contentType: string }) =>
    Promise.resolve(),
  );
  return {
    info: { project: { name: project }, timeout: 30_000, attach } as unknown as TestInfo,
    attach,
  };
}

/** Runs the _perfBuffer fixture around `body`, like Playwright does for one test. */
async function runBuffer(
  t: FakeTest,
  project: string,
  body: (buffer: { api: PerfApi; collector: unknown }) => Promise<void>,
) {
  const { info, attach } = testInfo(project);
  await fixture(t, '_perfBuffer')(
    { browserName: 'chromium' },
    async (buffer) => body(buffer as { api: PerfApi; collector: unknown }),
    info,
  );
  return attach;
}

afterEach(() => {
  vi.unstubAllEnvs();
  Reflect.deleteProperty(globalThis, REGISTRY_KEY);
});

describe('withPerfFixtures', () => {
  test('05-AC-01 outside perf mode adds only perf, without context or page overrides', async () => {
    vi.stubEnv('PW_PERF_MODE', '');
    const wrapped = wrap(fakeTest());
    expect(wrapped.fixtures.map((f) => Object.keys(f))).toEqual([['perf']]);
    // 05-REQ-32: the same API; track() does nothing.
    let api: PerfApi | undefined;
    await fixture(wrapped, 'perf')(
      {},
      async (value) => {
        api = value as PerfApi;
      },
      {} as TestInfo,
    );
    const context = new FakeContext();
    expect(() => api?.track(context.asContext())).not.toThrow();
    expect(context.listenerCount()).toBe(0);
  });

  test('in perf mode adds _perfBuffer (auto), context, page and perf', () => {
    vi.stubEnv('PW_PERF_MODE', 'test');
    const wrapped = wrap(fakeTest());
    expect(Object.keys(wrapped.fixtures[0] ?? {}).sort()).toEqual([
      '_perfBuffer',
      'context',
      'page',
      'perf',
    ]);
    expect(wrapped.fixtures[0]?._perfBuffer).toEqual([
      expect.any(Function),
      { auto: true, box: true },
    ]);
  });

  test('05-AC-15 wrapping a returned test object again returns it unchanged (05-REQ-22)', () => {
    for (const mode of ['', 'test']) {
      vi.stubEnv('PW_PERF_MODE', mode);
      const base = fakeTest();
      const once = wrap(base);
      expect(wrap(once)).toBe(once);
      expect(wrap(wrap(once))).toBe(once);
      expect(once.fixtures).toHaveLength(1);
    }
  });

  test('invalid mode variables throw ConfigError (01-REQ-27)', () => {
    vi.stubEnv('PW_PERF_MODE', 'yes');
    expect(() => wrap(fakeTest())).toThrow(ConfigError);
  });

  test('05-AC-16 a project that is not measured gets no collector and no attachment (05-REQ-21)', async () => {
    vi.stubEnv('PW_PERF_MODE', 'test');
    register(['chromium']);
    const wrapped = wrap(fakeTest());
    const attach = await runBuffer(wrapped, 'setup', async (buffer) => {
      expect(buffer.collector).toBeNull();
      const context = new FakeContext();
      buffer.api.track(context.asContext());
      expect(context.listenerCount()).toBe(0);
      expect(activeCollector()).toBeUndefined();
    });
    expect(attach).not.toHaveBeenCalled();
    // In the measured project every test has an attachment, also without requests (05-REQ-15).
    const measured = await runBuffer(wrapped, 'chromium', async () => undefined);
    expect(measured).toHaveBeenCalledTimes(1);
    const body = JSON.parse(measured.mock.calls[0]?.[1].body ?? '{}') as { requests: unknown[] };
    expect(measured.mock.calls[0]?.[0]).toBe(SAMPLES_ATTACHMENT_NAME);
    expect(body.requests).toEqual([]);
  });

  test('without withPerf() every project is measured with the default config (01-REQ-07)', async () => {
    vi.stubEnv('PW_PERF_MODE', 'test');
    const attach = await runBuffer(wrap(fakeTest()), 'any', async (buffer) => {
      expect(buffer.collector).not.toBeNull();
    });
    expect(attach).toHaveBeenCalledTimes(1);
  });
});

describe('the perf fixture (05-REQ-32, D-32)', () => {
  /** The perf fixture value of a test in the given mode. */
  async function perfApi(mode: string): Promise<PerfApi> {
    vi.stubEnv('PW_PERF_MODE', mode);
    let api: PerfApi | undefined;
    await fixture(wrap(fakeTest()), 'perf')(
      {},
      async (value) => {
        api = value as PerfApi;
      },
      {} as TestInfo,
    );
    if (api === undefined) throw new Error('no perf value');
    return api;
  }

  test('05-AC-23 PerfApi has only track; calling a removed method does not type-check', async () => {
    expectTypeOf<keyof PerfApi>().toEqualTypeOf<'track'>();
    const api = await perfApi('');
    expect(Object.keys(api)).toEqual(['track']);
    // @ts-expect-error -- perf.measure was removed (D-32)
    expect(api.measure).toBeUndefined();
  });

  test('05-AC-23 in JavaScript a removed method gives a TypeError in both modes', async () => {
    const removed = (api: PerfApi): void => {
      const loose = api as unknown as Record<string, () => unknown>;
      for (const name of ['measure', 'start', 'end', 'sampleStart', 'sampleEnd']) {
        expect(() => (loose[name] as () => unknown)(), name).toThrow(TypeError);
      }
    };
    removed(await perfApi(''));
    vi.stubEnv('PW_PERF_MODE', 'test');
    register(['chromium']);
    await runBuffer(wrap(fakeTest()), 'chromium', async ({ api }) => {
      removed(api);
    });
  });

  test('05-AC-23 perf.track in a test-scoped fixture measures the context in perf mode', async () => {
    vi.stubEnv('PW_PERF_MODE', 'test');
    register(['chromium']);
    const context = new FakeContext();
    const attach = await runBuffer(wrap(fakeTest()), 'chromium', async ({ api }) => {
      // What a fixture such as adminPage does with its own context.
      api.track(context.asContext());
      const request = new FakeRequest('http://app.test/api/admin');
      context.emit('request', request);
      finish(context, request);
    });
    const body = JSON.parse(attach.mock.calls[0]?.[1].body ?? '{}') as {
      requests: { url: string }[];
    };
    expect(body.requests.map((r) => r.url)).toEqual(['http://app.test/api/admin']);
  });

  test('05-AC-23 perf.track does nothing outside perf mode', async () => {
    const api = await perfApi('');
    const context = new FakeContext();
    api.track(context.asContext());
    expect(context.listenerCount()).toBe(0);
  });
});

describe('trackContext', () => {
  test('does nothing outside perf mode', () => {
    vi.stubEnv('PW_PERF_MODE', '');
    trackContext(new FakeContext().asContext());
    expect(trackedContexts().size).toBe(0);
  });

  test('registers a worker context until it closes and tracks it in every measured test (05-REQ-23)', async () => {
    vi.stubEnv('PW_PERF_MODE', 'test');
    register(['chromium']);
    const wrapped = wrap(fakeTest());
    const context = new FakeContext();
    trackContext(context.asContext());
    trackContext(context.asContext());
    expect([...trackedContexts()]).toEqual([context]);

    const urls: string[][] = [];
    for (const n of [1, 2]) {
      const attach = await runBuffer(wrapped, 'chromium', async () => {
        const request = new FakeRequest(`http://app.test/api/${n}`);
        context.emit('request', request);
        finish(context, request);
      });
      const body = JSON.parse(attach.mock.calls[0]?.[1].body ?? '{}') as {
        requests: { url: string }[];
      };
      urls.push(body.requests.map((r) => r.url));
    }
    expect(urls).toEqual([['http://app.test/api/1'], ['http://app.test/api/2']]);
    // Trackers are detached after each test.
    expect(context.listenerCount()).toBe(1); // only the registry's close listener
    context.close();
    expect(trackedContexts().size).toBe(0);
  });

  test('a context registered during a test is tracked in that test', async () => {
    vi.stubEnv('PW_PERF_MODE', 'test');
    register(['chromium']);
    const attach = await runBuffer(wrap(fakeTest()), 'chromium', async () => {
      const context = new FakeContext();
      trackContext(context.asContext() as BrowserContext);
      const request = new FakeRequest('http://app.test/api/late');
      context.emit('request', request);
      finish(context, request);
    });
    const body = JSON.parse(attach.mock.calls[0]?.[1].body ?? '{}') as { requests: unknown[] };
    expect(body.requests).toHaveLength(1);
  });
});
