import { afterEach, describe, expect, test, vi } from 'vitest';
import { SAMPLE_LIMIT_PER_TEST } from '../../../src/collector/constants.ts';
import { TestCollector } from '../../../src/collector/test-collector.ts';
import type { TestCollectorOptions } from '../../../src/collector/test-collector.ts';
import { perfDefaults } from '../../../src/core/config/index.ts';
import { parseSampleBatch } from '../../../src/core/schema/index.ts';
import { SAMPLES_ATTACHMENT_NAME } from '../../../src/core/types/index.ts';
import { createAjv, validator } from '../../contract/schemas.ts';
import { FakeContext, FakePage, FakeRequest, finish } from './fakes.ts';

const API = 'http://app.test/api';
const validateBatch = validator(createAjv(), 'samples.schema.json');
const noWait = { ...perfDefaults.measure, pendingTimeoutMs: 0 };

let clock = 0;
function collector(options: Partial<TestCollectorOptions> = {}): TestCollector {
  return new TestCollector({
    measure: perfDefaults.measure,
    version: '1.2.3',
    browserName: 'chromium',
    testTimeout: () => 30_000,
    now: () => clock,
    wallNow: () => 1_763_460_000_000,
    ...options,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  clock = 0;
});

describe('TestCollector', () => {
  test('05-AC-11 an empty batch and a full batch pass the samples schema', async () => {
    const empty = collector();
    await empty.drain();
    const emptyBatch = empty.batch();
    expect(emptyBatch).toEqual({
      schemaVersion: 1,
      collector: { name: 'playwright-js', version: '1.2.3', browserName: null },
      requests: [],
      custom: [],
      diagnostics: [],
    });
    const full = collector({ measure: noWait });
    const context = new FakeContext();
    full.track(context.asContext());
    const ok = new FakeRequest(`${API}/ok`);
    const failed = new FakeRequest(`${API}/failed`);
    const pending = new FakeRequest(`${API}/pending`);
    for (const r of [ok, failed, pending]) context.emit('request', r);
    finish(context, ok);
    failed.failureValue = { errorText: '' };
    context.emit('requestfailed', failed);
    full.api.start('open');
    await full.api.measure('step', () => undefined);
    full.api.end('missing');
    await full.drain();
    const fullBatch = full.batch();
    expect(fullBatch.requests.map((s) => s.status)).toEqual([200, 'FAILED', 'PENDING']);
    expect(fullBatch.custom.map((s) => s.outcome)).toEqual(['ok', 'unfinished']);
    for (const batch of [emptyBatch, fullBatch]) {
      expect(validateBatch(batch), JSON.stringify(validateBatch.errors)).toBe(true);
      expect(parseSampleBatch(JSON.stringify(batch), 'test').ok).toBe(true);
    }
  });

  test('samples of all trackers in finish order, PENDING last (05-REQ-15)', async () => {
    const c = collector({ measure: noWait });
    const one = new FakeContext();
    const two = new FakeContext();
    c.track(one.asContext());
    c.track(two.asContext());
    const a = new FakeRequest(`${API}/a`);
    const b = new FakeRequest(`${API}/b`);
    const p = new FakeRequest(`${API}/p`);
    const d = new FakeRequest(`${API}/d`);
    one.emit('request', p);
    one.emit('request', a);
    two.emit('request', b);
    two.emit('request', d);
    finish(two, b);
    finish(one, a);
    await c.drain();
    finish(two, d); // after the drain: ignored
    expect(c.batch().requests.map((s) => [s.url.slice(API.length), s.status])).toEqual([
      ['/b', 200],
      ['/a', 200],
      ['/p', 'PENDING'],
      ['/d', 'PENDING'],
    ]);
  });

  test('one tracker per context; no new trackers once draining (05-REQ-04)', async () => {
    const c = collector();
    const context = new FakeContext();
    expect(c.track(context.asContext())).toBe(true);
    expect(c.track(context.asContext())).toBe(false);
    const request = new FakeRequest(API);
    context.emit('request', request);
    finish(context, request);
    await c.drain();
    expect(c.track(new FakeContext().asContext())).toBe(false);
    expect(c.batch().requests).toHaveLength(1);
  });

  test('the page override tracks an untracked page context once per test (05-REQ-14)', async () => {
    const c = collector();
    const tracked = new FakeContext();
    c.track(tracked.asContext());
    c.coverPage(new FakePage(tracked).asPage());
    expect(c.batch().diagnostics).toEqual([]);
    const own = new FakeContext();
    c.coverPage(new FakePage(own).asPage());
    c.coverPage(new FakePage(new FakeContext()).asPage());
    const request = new FakeRequest(API);
    own.emit('request', request);
    finish(own, request);
    await c.drain();
    const batch = c.batch();
    expect(batch.requests).toHaveLength(1);
    expect(batch.diagnostics.map((d) => [d.code, d.count])).toEqual([
      ['COLLECTOR_CONTEXT_AUTO_TRACKED', undefined],
    ]);
  });

  test('browserName from the first tracked context, else the option, else null (05-REQ-29)', () => {
    const c = collector({ browserName: 'chromium' });
    expect(c.batch().collector.browserName).toBeNull();
    c.track(new FakeContext('webkit').asContext());
    c.track(new FakeContext('firefox').asContext());
    expect(c.batch().collector.browserName).toBe('webkit');
    const persistent = collector({ browserName: 'firefox' });
    persistent.track(new FakeContext(null).asContext());
    expect(persistent.batch().collector.browserName).toBe('firefox');
  });

  test('drains once per test with the budget from the teardown start (05-REQ-13, 05-REQ-27)', async () => {
    vi.useFakeTimers();
    const c = collector({ testTimeout: () => 3000 });
    const context = new FakeContext();
    c.track(context.asContext());
    context.emit('request', new FakeRequest(API));
    clock = 100;
    c.markTeardownStart();
    clock = 600; // 500 ms of user teardowns: budget 3000 - 500 - 1000 = 1500
    let done = false;
    const first = c.drain().then(() => (done = true));
    expect(c.drain()).toBe(c.drain());
    await vi.advanceTimersByTimeAsync(1499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await first;
    expect(c.batch().requests.map((s) => s.status)).toEqual(['PENDING']);
  });

  test('keeps at most SAMPLE_LIMIT_PER_TEST request samples and counts the rest (05-REQ-16)', async () => {
    expect(SAMPLE_LIMIT_PER_TEST).toBe(20_000);
    const c = collector();
    const context = new FakeContext();
    c.track(context.asContext());
    for (let i = 0; i < SAMPLE_LIMIT_PER_TEST + 3; i++) {
      const request = new FakeRequest(`${API}/${i}`);
      context.emit('request', request);
      finish(context, request);
    }
    await c.drain();
    const batch = c.batch();
    expect(batch.requests).toHaveLength(SAMPLE_LIMIT_PER_TEST);
    expect(batch.diagnostics).toEqual([
      expect.objectContaining({ code: 'COLLECTOR_SAMPLE_LIMIT_REACHED', count: 3 }),
    ]);
  });

  test('attaches the batch as JSON under the package name (05-REQ-15, 02-REQ-14)', async () => {
    const c = collector();
    const attach = vi.fn(() => Promise.resolve());
    await c.attach({ attach });
    expect(attach).toHaveBeenCalledWith(SAMPLES_ATTACHMENT_NAME, {
      body: expect.any(String),
      contentType: 'application/json',
    });
    expect(SAMPLES_ATTACHMENT_NAME).toBe('pw-perf-samples');
  });

  test('a failing attachment is reported on stderr and never thrown (05-REQ-20)', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const c = collector();
    await expect(
      c.attach({ attach: () => Promise.reject(new Error('disk full')) }),
    ).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledWith(
      expect.stringMatching(/^COLLECTOR_ATTACH_FAILED: .*disk full/u),
    );
  });
});
