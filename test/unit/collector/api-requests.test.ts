import { afterEach, describe, expect, test } from 'vitest';
import {
  describeCall,
  isApiRequestContext,
  resolveUrl,
  wrapRequestContext,
} from '../../../src/collector/api-requests.ts';
import type { ApiCall, ApiRecorder, ApiSource } from '../../../src/collector/api-requests.ts';
import { TestCollector } from '../../../src/collector/test-collector.ts';
import type { TestCollectorOptions } from '../../../src/collector/test-collector.ts';
import { perfDefaults } from '../../../src/core/config/index.ts';
import { parseSampleBatch } from '../../../src/core/schema/index.ts';
import { setActiveCollector } from '../../../src/registry/index.ts';
import { createAjv, validator } from '../../contract/schemas.ts';
import { FakeContext } from './fakes.ts';

const validateBatch = validator(createAjv(), 'samples.schema.json');

/** A stand-in for APIRequestContext: get() calls fetch() like Playwright does. */
class FakeApi {
  readonly calls: string[] = [];
  next: (url: string) => Promise<unknown> = (url) =>
    Promise.resolve({ status: () => 200, url: () => url });
  fetch(url: unknown, options?: { method?: string }): Promise<unknown> {
    this.calls.push(`${options?.method ?? 'GET'} ${String(url)}`);
    return this.next(String(url));
  }
  get(url: string, options?: object): Promise<unknown> {
    return this.fetch(url, { ...options, method: 'GET' });
  }
  post(url: string, options?: object): Promise<unknown> {
    return this.fetch(url, { ...options, method: 'POST' });
  }
  put(url: string): Promise<unknown> {
    return this.fetch(url, { method: 'PUT' });
  }
  patch(url: string): Promise<unknown> {
    return this.fetch(url, { method: 'PATCH' });
  }
  delete(url: string): Promise<unknown> {
    return this.fetch(url, { method: 'DELETE' });
  }
  head(url: string): Promise<unknown> {
    return this.fetch(url, { method: 'HEAD' });
  }
  dispose(): Promise<void> {
    return Promise.resolve();
  }
  storageState(): Promise<object> {
    return Promise.resolve({});
  }
}

/** A recorder that only lists the calls it saw. */
function listRecorder(): ApiRecorder & { seen: [ApiCall, ApiSource][] } {
  const seen: [ApiCall, ApiSource][] = [];
  return {
    seen,
    observeApiCall: (call, source, result) => {
      seen.push([call, source]);
      return result;
    },
  };
}

let clock = 0;
function collector(options: Partial<TestCollectorOptions> = {}): TestCollector {
  const c = new TestCollector({
    measure: perfDefaults.measure,
    version: '1.2.3',
    browserName: null,
    testTimeout: () => 30_000,
    now: () => clock,
    wallNow: () => 1_763_460_000_000,
    baseURL: 'http://app.test',
    ...options,
  });
  setActiveCollector(c);
  return c;
}

afterEach(() => {
  setActiveCollector(undefined);
  clock = 0;
});

describe('describeCall and resolveUrl (15-REQ-05)', () => {
  test('methods, fetch without a method, fetch with a Request object', () => {
    expect(describeCall('post', ['http://a.test/x'], undefined)).toEqual({
      method: 'POST',
      rawUrl: 'http://a.test/x',
      url: 'http://a.test/x',
    });
    expect(describeCall('fetch', ['/x'], 'http://a.test')?.method).toBe('GET');
    expect(describeCall('fetch', ['/x', { method: 'patch' }], 'http://a.test')?.method).toBe(
      'PATCH',
    );
    const request = { url: () => 'http://a.test/r', method: () => 'DELETE' };
    expect(describeCall('fetch', [request], undefined)).toEqual({
      method: 'DELETE',
      rawUrl: 'http://a.test/r',
      url: 'http://a.test/r',
    });
    expect(describeCall('fetch', ['/x', { method: 'M-SEARCH' }], undefined)).toBeUndefined();
  });

  test('a relative URL resolves against baseURL, otherwise it stays unresolved', () => {
    expect(resolveUrl('/api/a?b=1', 'http://app.test/base/')).toBe('http://app.test/api/a?b=1');
    expect(resolveUrl('api/a', 'http://app.test/base/')).toBe('http://app.test/base/api/a');
    expect(resolveUrl('/api/a', undefined)).toBeNull();
    expect(resolveUrl('https://x.test', undefined)).toBe('https://x.test/');
  });

  test('isApiRequestContext accepts only objects with the request methods', () => {
    expect(isApiRequestContext(new FakeApi())).toBe(true);
    expect(isApiRequestContext({ fetch: () => undefined })).toBe(false);
    expect(isApiRequestContext(null)).toBe(false);
  });
});

describe('wrapRequestContext (15-REQ-03, 15-REQ-04)', () => {
  test('15-AC-02 wraps once; a nested fetch() inside get() is one call', async () => {
    const api = new FakeApi();
    const recorder = listRecorder();
    expect(wrapRequestContext(api, 'context', 'http://app.test', () => recorder)).toBe(true);
    expect(wrapRequestContext(api, 'request', undefined, () => recorder)).toBe(false);
    await api.get('/api/a');
    await api.post('http://other.test/b');
    expect(recorder.seen).toEqual([
      [{ method: 'GET', rawUrl: '/api/a', url: 'http://app.test/api/a' }, 'context'],
      [{ method: 'POST', rawUrl: 'http://other.test/b', url: 'http://other.test/b' }, 'context'],
    ]);
    expect(api.calls).toEqual(['GET /api/a', 'POST http://other.test/b']);
  });

  test('without a recorder (no measured test) the call passes through', async () => {
    const api = new FakeApi();
    const recorder = listRecorder();
    const state: { active: ApiRecorder | undefined } = { active: undefined };
    wrapRequestContext(api, 'tracked', undefined, () => state.active);
    await api.get('http://app.test/a');
    state.active = recorder;
    await api.get('http://app.test/b');
    expect(recorder.seen.map(([call]) => call.rawUrl)).toEqual(['http://app.test/b']);
  });
});

describe('TestCollector: API calls (15-REQ-05 – 15-REQ-09)', () => {
  test('15-AC-01 15-AC-03 samples of an ok call, a failed call and a pending call', async () => {
    const c = collector({ measure: { ...perfDefaults.measure, pendingTimeoutMs: 0 } });
    const api = new FakeApi();
    c.wrapRequest(api, 'request');
    clock = 10;
    const ok = api.get('/api/tickets/7');
    clock = 215.04;
    await ok;
    const error = new Error('apiRequestContext.get: Timeout 50ms exceeded.\nCall log: …');
    api.next = () => Promise.reject(error);
    await expect(api.post('/api/slow')).rejects.toBe(error);
    api.next = () =>
      new Promise(() => {
        // never settles
      });
    void api.delete('/api/orders/1');
    await c.drain();
    const batch = c.batch();
    expect(batch.apiRequests).toEqual([
      {
        method: 'GET',
        url: 'http://app.test/api/tickets/7',
        status: 200,
        startTime: 1_763_460_000_000,
        duration: 205,
        source: 'request',
      },
      {
        method: 'POST',
        url: 'http://app.test/api/slow',
        status: 'FAILED',
        failureText: 'apiRequestContext.get: Timeout 50ms exceeded.',
        startTime: 1_763_460_000_000,
        duration: null,
        source: 'request',
      },
      {
        method: 'DELETE',
        url: 'http://app.test/api/orders/1',
        status: 'PENDING',
        startTime: 1_763_460_000_000,
        duration: null,
        source: 'request',
      },
    ]);
    expect(validateBatch(batch), JSON.stringify(validateBatch.errors)).toBe(true);
    expect(parseSampleBatch(JSON.stringify(batch), 'api').ok).toBe(true);
  });

  test('15-REQ-06 include, exclude and known third parties filter API calls; resourceTypes do not', async () => {
    const c = collector({
      measure: { ...perfDefaults.measure, resourceTypes: ['document'], exclude: ['/health'] },
    });
    const api = new FakeApi();
    c.wrapRequest(api, 'request');
    await api.get('/api/a');
    await api.get('/health');
    await api.get('https://www.google-analytics.com/collect');
    await c.drain();
    expect(c.batch().apiRequests.map((s) => s.url)).toEqual(['http://app.test/api/a']);
  });

  test('a relative call without baseURL takes the URL of the response', async () => {
    const c = collector({ baseURL: undefined });
    const api = new FakeApi();
    api.next = () => Promise.resolve({ status: () => 204, url: () => 'http://own.test/api/x' });
    c.trackRequestContext(api as never);
    await api.get('/api/x');
    await c.drain();
    expect(c.batch().apiRequests).toMatchObject([
      { url: 'http://own.test/api/x', status: 204, source: 'tracked' },
    ]);
  });

  test('15-AC-07 trackRequestContext with another object gives COLLECTOR_REQUEST_CONTEXT_NOT_TRACKED', async () => {
    const c = collector();
    c.trackRequestContext({} as never);
    c.api.trackRequestContext('nope' as never);
    await c.drain();
    expect(c.batch().diagnostics).toEqual([
      expect.objectContaining({ code: 'COLLECTOR_REQUEST_CONTEXT_NOT_TRACKED', count: 2 }),
    ]);
  });

  test('15-AC-02 tracking a context wraps its request object once', async () => {
    const c = collector();
    const context = new FakeContext();
    const api = new FakeApi();
    Object.assign(context, { request: api });
    c.track(context.asContext());
    c.track(context.asContext());
    await api.post('/api/orders');
    await c.drain();
    expect(c.batch().apiRequests).toMatchObject([{ method: 'POST', source: 'context' }]);
  });

  test('calls after the end-of-test wait started are not measured', async () => {
    const c = collector();
    const api = new FakeApi();
    c.wrapRequest(api, 'request');
    await c.drain();
    await api.get('/api/late');
    expect(c.batch().apiRequests).toEqual([]);
  });
});
