import { describe, expect, test } from 'vitest';
import { CustomTimer, validateMeasurementName } from '../../../src/collector/custom-timer.ts';
import { createDiagnostics } from '../../../src/collector/diagnostics.ts';
import { createPerfApi } from '../../../src/collector/perf-api.ts';
import { parseSampleBatch } from '../../../src/core/schema/index.ts';
import type { Diagnostics } from '../../../src/core/types/index.ts';

/** A clock moved by hand. */
function clock(start = 1000) {
  let t = start;
  return {
    now: () => t,
    wallNow: () => 1_763_460_000_000 + t,
    advance(ms: number) {
      t += ms;
    },
  };
}

function timer(record = true): {
  timer: CustomTimer;
  diag: Diagnostics;
  c: ReturnType<typeof clock>;
} {
  const c = clock();
  const diag = createDiagnostics();
  return { timer: new CustomTimer({ now: c.now, wallNow: c.wallNow, record }, diag), diag, c };
}

describe('CustomTimer', () => {
  test('06-AC-01 measure returns the result, rethrows the same error and records error', async () => {
    const { timer: t, c } = timer();
    await expect(
      t.measure('a', () => {
        c.advance(12.34);
        return 42;
      }),
    ).resolves.toBe(42);
    await expect(
      t.measure('b', async () => {
        c.advance(5);
        return 'x';
      }),
    ).resolves.toBe('x');
    const error = new Error('boom');
    await expect(
      t.measure('c', () => {
        c.advance(3);
        throw error;
      }),
    ).rejects.toBe(error);
    const rejection = { reason: 'plain object' };
    await expect(
      t.measure('d', () => {
        c.advance(1);
        return Promise.reject(rejection);
      }),
    ).rejects.toBe(rejection);
    expect(t.finish()).toEqual([
      { name: 'a', outcome: 'ok', duration: 12.3, endTime: 1_763_460_001_012 },
      { name: 'b', outcome: 'ok', duration: 5, endTime: 1_763_460_001_017 },
      { name: 'c', outcome: 'error', duration: 3, endTime: 1_763_460_001_020 },
      { name: 'd', outcome: 'error', duration: 1, endTime: 1_763_460_001_021 },
    ]);
  });

  test('measure calls fn exactly once', async () => {
    const { timer: t } = timer();
    let calls = 0;
    await t.measure('a', () => {
      calls += 1;
    });
    expect(calls).toBe(1);
  });

  test('06-AC-02 repeated start, end without start and unfinished measurements', async () => {
    const { timer: t, diag, c } = timer();
    t.start('x');
    c.advance(10);
    t.start('x'); // 06-REQ-06: the first one becomes unfinished
    c.advance(5);
    expect(t.end('x')).toBe(5);
    expect(t.end('x')).toBeUndefined(); // 06-REQ-07
    expect(t.end('never')).toBeUndefined();
    expect(t.end('never')).toBeUndefined();
    t.start('open-1'); // 06-REQ-09
    t.start('open-2');
    let release = (): void => undefined;
    const running = t.measure('in-flight', () => new Promise<void>((r) => (release = r)));
    const samples = t.finish();
    expect(samples).toEqual([
      { name: 'x', outcome: 'unfinished', duration: null, endTime: null },
      { name: 'x', outcome: 'ok', duration: 5, endTime: 1_763_460_001_015 },
      { name: 'open-1', outcome: 'unfinished', duration: null, endTime: null },
      { name: 'open-2', outcome: 'unfinished', duration: null, endTime: null },
      { name: 'in-flight', outcome: 'unfinished', duration: null, endTime: null },
    ]);
    // A measure() that settles after the end of the test adds nothing.
    release();
    await running;
    expect(t.finish()).toEqual(samples);
    expect(diag.list().map(({ code, count }) => [code, count])).toEqual([
      ['CUSTOM_ALREADY_STARTED', undefined],
      // Different names are different messages; the same name repeated is collapsed.
      ['CUSTOM_END_WITHOUT_START', undefined],
      ['CUSTOM_END_WITHOUT_START', 2],
      ['CUSTOM_UNFINISHED', 3],
    ]);
  });

  test('06-AC-03 nested and parallel measure calls with the same name are separate', async () => {
    const { timer: t, c } = timer();
    const resolvers: (() => void)[] = [];
    const later = () => new Promise<void>((r) => resolvers.push(r));
    await t.measure('same', async () => {
      c.advance(1);
      await t.measure('same', () => {
        c.advance(2);
      });
      c.advance(3);
    });
    // measure() starts its clock synchronously, before the first await.
    const p1 = t.measure('par', later);
    c.advance(10);
    const p2 = t.measure('par', later);
    t.start('par'); // does not collide with measure()
    c.advance(4);
    resolvers[1]?.();
    await p2;
    c.advance(1);
    resolvers[0]?.();
    await p1;
    expect(t.end('par')).toBe(5);
    expect(t.finish().map((s) => [s.name, s.outcome, s.duration])).toEqual([
      ['same', 'ok', 2],
      ['same', 'ok', 6],
      ['par', 'ok', 4],
      ['par', 'ok', 15],
      ['par', 'ok', 5],
    ]);
  });

  test('06-AC-05 an invalid name throws TypeError with CUSTOM_INVALID_NAME', async () => {
    for (const record of [true, false]) {
      const { timer: t } = timer(record);
      for (const name of [
        '',
        '   ',
        ' lead',
        'trail ',
        'tab\there',
        'nl\n',
        'del\u007F',
        'x'.repeat(201),
        42,
      ]) {
        expect(() => t.start(name as string), JSON.stringify(name)).toThrow(TypeError);
        expect(() => t.end(name as string)).toThrow(/CUSTOM_INVALID_NAME/u);
        await expect(t.measure(name as string, () => 1)).rejects.toThrow(/CUSTOM_INVALID_NAME/u);
      }
      expect(() => validateMeasurementName('x'.repeat(200))).not.toThrow();
      expect(() => validateMeasurementName('😀'.repeat(200))).not.toThrow();
      expect(() => validateMeasurementName('GET /api/x · größe')).not.toThrow();
      expect(t.finish()).toEqual([]);
    }
  });

  test('06-AC-06 sampleStart and sampleEnd give the same samples as start and end', () => {
    const run = (alias: boolean) => {
      const { timer: t, diag, c } = timer();
      const api = createPerfApi(t, () => undefined);
      const [start, end] = alias ? [api.sampleStart, api.sampleEnd] : [api.start, api.end];
      start('step');
      c.advance(7.25);
      const duration = end('step');
      end('none');
      return { duration, samples: t.finish(), diagnostics: diag.list() };
    };
    expect(run(true)).toEqual(run(false));
    expect(run(true).duration).toBe(7.3);
  });

  test('06-AC-07 samples pass the customSample schema', async () => {
    const { timer: t, c } = timer();
    await t.measure('ok', () => c.advance(1));
    await t.measure('error', () => Promise.reject(new Error('x'))).catch(() => undefined);
    t.start('unfinished');
    const batch = {
      schemaVersion: 1,
      collector: { name: 'playwright-js', version: '0.0.0', browserName: null },
      requests: [],
      custom: t.finish(),
      diagnostics: [],
    };
    const parsed = parseSampleBatch(JSON.stringify(batch), 'test');
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
  });

  test('06-AC-08 with an injected clock the duration is the difference rounded to 0.1 ms', () => {
    const { timer: t, c } = timer();
    t.start('a');
    c.advance(123.456);
    expect(t.end('a')).toBe(123.5);
    t.start('b');
    c.advance(0.04);
    expect(t.end('b')).toBe(0);
    expect(t.finish().map((s) => s.duration)).toEqual([123.5, 0]);
  });

  test('outside perf mode durations are returned but nothing is recorded (06-REQ-10)', async () => {
    const { timer: t, diag, c } = timer(false);
    t.start('a');
    c.advance(2);
    expect(t.end('a')).toBe(2);
    expect(t.end('a')).toBeUndefined();
    t.start('b');
    t.start('b');
    await expect(t.measure('m', () => 'r')).resolves.toBe('r');
    expect(t.finish()).toEqual([]);
    expect(diag.list()).toEqual([]);
  });
});

describe('diagnostics', () => {
  test('collapse the same code and message with count', () => {
    const diag = createDiagnostics();
    diag.add({ code: 'A', message: 'm' });
    diag.add({ code: 'A', message: 'm' });
    diag.add({ code: 'A', message: 'other' });
    diag.add({ code: 'B', message: 'm', count: 5 });
    diag.add({ code: 'B', message: 'm', count: 2 });
    expect(diag.list()).toEqual([
      { code: 'A', message: 'm', count: 2 },
      { code: 'A', message: 'other' },
      { code: 'B', message: 'm', count: 7 },
    ]);
  });
});
