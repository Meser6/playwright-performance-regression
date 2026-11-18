import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createDiagnostics } from '../../../src/collector/diagnostics.ts';
import { RequestTracker } from '../../../src/collector/request-tracker.ts';
import type { SampleSink } from '../../../src/collector/request-tracker.ts';
import { perfDefaults } from '../../../src/core/config/index.ts';
import { CONTEXT_CLOSED_FAILURE_TEXT } from '../../../src/core/types/index.ts';
import type { RawRequestSample } from '../../../src/core/types/index.ts';
import { FakeContext, FakeRequest, FakeResponse, finish, timing } from './fakes.ts';

const API = 'http://app.test/api/orders';

let nodeClock = 0;
function setup(context = new FakeContext()) {
  const diag = createDiagnostics();
  const finished: RawRequestSample[] = [];
  const pending: RawRequestSample[] = [];
  const sink: SampleSink = { finished: (s) => finished.push(s), pending: (s) => pending.push(s) };
  const tracker = new RequestTracker(
    context.asContext(),
    { measure: perfDefaults.measure, now: () => nodeClock, wallNow: () => 1_763_460_009_999 },
    diag,
    sink,
  );
  return { context, tracker, diag, finished, pending };
}

beforeEach(() => {
  nodeClock = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RequestTracker', () => {
  test('turns a finished request into a sample (05, chapter 5.4)', async () => {
    const { context, tracker, finished, pending } = setup();
    const request = new FakeRequest(API, { method: 'post', resourceType: 'xhr' });
    context.emit('request', request);
    finish(context, request, { status: 201 });
    await tracker.drain(0);
    expect(finished).toEqual([
      {
        method: 'POST',
        url: API,
        resourceType: 'xhr',
        status: 201,
        startTime: 1_763_460_000_000,
        duration: 102.3,
        requestStart: 0.5,
        ttfb: 100,
        timeSource: 'browser',
        fromServiceWorker: false,
      },
    ]);
    expect(pending).toEqual([]);
  });

  test('falls back to the worker clock without responseEnd (05-REQ-10)', async () => {
    const { context, tracker, finished } = setup();
    const request = new FakeRequest(API);
    nodeClock = 10;
    context.emit('request', request);
    nodeClock = 55.55;
    finish(context, request, { timing: { responseEnd: -1, requestStart: -1, responseStart: -1 } });
    await tracker.drain(0);
    expect(finished[0]).toMatchObject({
      duration: 45.6,
      requestStart: null,
      ttfb: null,
      timeSource: 'node',
    });
  });

  test('reads the response when no response event was seen', async () => {
    const { context, tracker, finished } = setup();
    const request = new FakeRequest(API);
    context.emit('request', request);
    finish(context, request, { responseEvent: false, status: 204 });
    await tracker.drain(1000);
    expect(finished.map((s) => s.status)).toEqual([204]);
  });

  test('a service worker response is flagged; service worker requests are skipped (05-REQ-05)', async () => {
    const { context, tracker, finished } = setup();
    const page = new FakeRequest(API);
    const worker = new FakeRequest(API, { serviceWorker: true });
    context.emit('request', page);
    context.emit('request', worker);
    finish(context, worker);
    finish(context, page, { sw: true });
    await tracker.drain(0);
    expect(finished.map((s) => s.fromServiceWorker)).toEqual([true]);
  });

  test('applies the filters: static files and other schemes leave no trace (05, chapter 5.2)', async () => {
    const { context, tracker, finished, pending } = setup();
    for (const url of ['http://app.test/app.js', 'data:text/plain,x']) {
      const request = new FakeRequest(url);
      context.emit('request', request);
      finish(context, request);
    }
    context.emit('request', new FakeRequest('http://app.test/a.png', { resourceType: 'image' }));
    await tracker.drain(0);
    expect([...finished, ...pending]).toEqual([]);
  });

  test('requestfailed gives FAILED with the browser text, empty text as unknown (05-REQ-11)', async () => {
    const { context, tracker, finished } = setup();
    const aborted = new FakeRequest(`${API}/1`);
    const empty = new FakeRequest(`${API}/2`);
    context.emit('request', aborted);
    context.emit('request', empty);
    aborted.failureValue = { errorText: 'net::ERR_ABORTED' };
    aborted.timingValue = timing({ startTime: 1_763_460_000_500.4 });
    empty.failureValue = { errorText: '' };
    context.emit('requestfailed', aborted);
    context.emit('requestfailed', empty);
    await tracker.drain(0);
    expect(finished).toEqual([
      {
        method: 'GET',
        url: `${API}/1`,
        resourceType: 'fetch',
        status: 'FAILED',
        failureText: 'net::ERR_ABORTED',
        startTime: 1_763_460_000_500,
        duration: null,
        requestStart: null,
        ttfb: null,
        timeSource: 'browser',
        fromServiceWorker: false,
      },
      expect.objectContaining({ status: 'FAILED', failureText: 'unknown' }),
    ]);
  });

  test('skips events of requests it did not see start, without diagnostics (05-REQ-25)', async () => {
    const { context, tracker, finished, pending, diag } = setup();
    const before = new FakeRequest(API);
    finish(context, before);
    before.failureValue = { errorText: 'net::ERR_FAILED' };
    context.emit('requestfailed', before);
    await tracker.drain(0);
    expect([...finished, ...pending, ...diag.list()]).toEqual([]);
  });

  test('waits for requests in flight and stops early when they finish (05-REQ-13)', async () => {
    vi.useFakeTimers();
    const { context, tracker, finished } = setup();
    const request = new FakeRequest(API);
    context.emit('request', request);
    let done = false;
    const drained = tracker.drain(5000).then(() => (done = true));
    // Not accepted any more after the drain started.
    context.emit('request', new FakeRequest(`${API}/late`));
    await vi.advanceTimersByTimeAsync(300);
    expect(done).toBe(false);
    finish(context, request);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    await drained;
    expect(finished.map((s) => s.url)).toEqual([API]);
  });

  test('after the budget: PENDING without response, HTTP status without requestfinished (05-REQ-13, 05-REQ-31)', async () => {
    vi.useFakeTimers();
    const { context, tracker, finished, pending } = setup();
    const hanging = new FakeRequest(`${API}/hang`);
    const unread = new FakeRequest(`${API}/unread`);
    context.emit('request', hanging);
    context.emit('request', unread);
    hanging.timingValue = timing({ startTime: 1_763_460_000_100 });
    unread.timingValue = timing({ requestStart: 1.25, responseStart: 30.5 });
    context.emit('response', new FakeResponse(unread, 200));
    const drained = tracker.drain(500);
    await vi.advanceTimersByTimeAsync(499);
    expect(pending).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await drained;
    expect(finished).toEqual([
      {
        method: 'GET',
        url: `${API}/unread`,
        resourceType: 'fetch',
        status: 200,
        startTime: 1_763_460_000_000,
        duration: null,
        requestStart: 1.3,
        ttfb: 29.3,
        timeSource: 'browser',
        fromServiceWorker: false,
      },
    ]);
    expect(pending).toEqual([
      {
        method: 'GET',
        url: `${API}/hang`,
        resourceType: 'fetch',
        status: 'PENDING',
        startTime: 1_763_460_000_100,
        duration: null,
        requestStart: null,
        ttfb: null,
        timeSource: 'browser',
        fromServiceWorker: false,
      },
    ]);
    // Events after the drain change nothing.
    finish(context, hanging);
    expect(finished).toHaveLength(1);
  });

  test('a closed context fails its requests at once and the drain does not wait (05-REQ-30)', async () => {
    vi.useFakeTimers();
    const context = new FakeContext();
    const page = context.newPage();
    const { tracker, finished, pending } = setup(context);
    const request = new FakeRequest(API, { page });
    context.emit('request', request);
    context.close();
    expect(tracker.closed).toBe(true);
    expect(finished).toEqual([
      expect.objectContaining({
        status: 'FAILED',
        failureText: CONTEXT_CLOSED_FAILURE_TEXT,
        duration: null,
      }),
    ]);
    let done = false;
    const drained = tracker.drain(10_000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    await drained;
    expect(pending).toEqual([]);
  });

  test('a closed page fails only its own requests (05-REQ-30)', async () => {
    const context = new FakeContext();
    const first = context.newPage();
    const { tracker, finished, pending } = setup(context);
    const second = context.newPage(); // opened after attaching: popups, new tabs
    const a = new FakeRequest(`${API}/a`, { page: first });
    const b = new FakeRequest(`${API}/b`, { page: second });
    context.emit('request', a);
    context.emit('request', b);
    second.emit('close', second);
    expect(finished.map((s) => [s.url, s.status, s.failureText])).toEqual([
      [`${API}/b`, 'FAILED', CONTEXT_CLOSED_FAILURE_TEXT],
    ]);
    await tracker.drain(0);
    expect(pending.map((s) => s.url)).toEqual([`${API}/a`]);
  });

  test('05-AC-07 an exception in a handler is caught and reported with count', async () => {
    const { context, tracker, diag, finished } = setup();
    const broken = new FakeRequest(API);
    broken.url = () => {
      throw new Error('injected');
    };
    expect(() => context.emit('request', broken)).not.toThrow();
    expect(() => context.emit('request', broken)).not.toThrow();
    // Other requests are still measured.
    const ok = new FakeRequest(API);
    context.emit('request', ok);
    finish(context, ok);
    await tracker.drain(0);
    expect(finished).toHaveLength(1);
    expect(diag.list()).toEqual([
      {
        code: 'COLLECTOR_LISTENER_ERROR',
        message: 'collector: the "request" handler failed and the event was skipped: injected',
        hint: expect.any(String),
        count: 2,
      },
    ]);
  });

  test('a failing timing read skips the sample with COLLECTOR_TIMING_FAILED', async () => {
    const { context, tracker, diag, finished } = setup();
    const request = new FakeRequest(API);
    context.emit('request', request);
    request.timing = () => {
      throw new Error('gone');
    };
    request.responseValue = new FakeResponse(request);
    context.emit('response', request.responseValue);
    context.emit('requestfinished', request);
    await tracker.drain(0);
    expect(finished).toEqual([]);
    expect(diag.list().map((d) => d.code)).toEqual(['COLLECTOR_TIMING_FAILED']);
  });

  test('detaches every listener after the drain (05-REQ-24)', async () => {
    const context = new FakeContext();
    const page = context.newPage();
    const { tracker } = setup(context);
    expect(context.listenerCount()).toBeGreaterThan(0);
    expect(page.listenerCount()).toBe(1);
    await tracker.drain(0);
    await tracker.drain(0);
    expect(context.listenerCount()).toBe(0);
    expect(page.listenerCount()).toBe(0);
  });
});
