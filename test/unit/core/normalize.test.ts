import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../../../src/core/config/index.ts';
import type {
  KeyBuilder,
  PerfConfigInput,
  ResolvedConfig,
} from '../../../src/core/config/index.ts';
import { MAX_KEY_LENGTH, createKeyBuilder } from '../../../src/core/normalize/index.ts';
import type { KeyResult } from '../../../src/core/normalize/index.ts';
import { hash53 } from '../../../src/core/random/index.ts';
import { collapseIssues } from '../../../src/core/report/index.ts';

function config(input: PerfConfigInput = {}): ResolvedConfig {
  const result = resolveConfig(input, {});
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value.config;
}

function keysOf(input: PerfConfigInput['keys'] = {}): ResolvedConfig['keys'] {
  return config({ keys: input }).keys;
}

const BASE = { baseOrigins: ['https://app.example.com'] };

function build(
  url: string,
  keys: PerfConfigInput['keys'] = {},
  ctx = BASE,
  method = 'GET',
): KeyResult {
  return createKeyBuilder(keysOf(keys), ctx)({ method, url, resourceType: 'fetch' });
}

function keyOf(result: KeyResult): string {
  if (!result.ok) throw new Error(`skipped: ${JSON.stringify(result.issues)}`);
  return result.key;
}

/** Deterministic generator for property tests: hash53 of a counter (07, chapter 15). */
function generator(seed: number) {
  let n = 0;
  const next = (): number => hash53(String(n++), seed) / 2 ** 53;
  const int = (max: number): number => Math.floor(next() * max);
  const pick = (chars: string, length: number): string =>
    Array.from({ length }, () => chars[int(chars.length)]).join('');
  return { int, pick };
}

const DIGITS = '0123456789';
const HEX = '0123456789abcdefABCDEF';
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function idGenerators(g: ReturnType<typeof generator>) {
  return {
    number: () => g.pick(DIGITS, 1 + g.int(12)),
    uuid: () => [8, 4, 4, 4, 12].map((length) => g.pick(HEX, length)).join('-'),
    hex: () => g.pick(HEX, 16 + g.int(24)),
    // At least one digit, 24+ characters without separators.
    token: () => g.pick(DIGITS, 1) + g.pick(ALNUM, 23 + g.int(20)),
  };
}

describe('property tests (07-REQ-14)', () => {
  test('07-AC-02 URLs differing only in path ids and query values give the same key', () => {
    const g = generator(7);
    const ids = idGenerators(g);
    const kinds = Object.values(ids);
    const anyValue = (): string => encodeURIComponent(g.pick(`${ALNUM} -_.~@/?&=#%,`, g.int(30)));
    const builder = createKeyBuilder(keysOf(), BASE);
    for (let t = 0; t < 200; t++) {
      const shape = Array.from({ length: 1 + g.int(5) }, () =>
        g.int(2) === 0 ? `res${g.int(5)}` : (kinds[g.int(kinds.length)] ?? ids.number),
      );
      const names = Array.from({ length: g.int(4) }, (_, i) => `p${i}`);
      const url = (): string => {
        const path = shape.map((s) => (typeof s === 'string' ? s : s())).join('/');
        const query = names.map((n) => `${n}=${anyValue()}`).join('&');
        return `https://app.example.com/${path}${query === '' ? '' : `?${query}`}`;
      };
      const keys = new Set(
        Array.from({ length: 5 }, () =>
          keyOf(builder({ method: 'GET', url: url(), resourceType: 'fetch' })),
        ),
      );
      expect(keys.size).toBe(1);
    }
  });

  test('07-AC-03 no injected marker appears in the key (1000 URLs)', () => {
    const g = generator(11);
    const ids = idGenerators(g);
    const builder = createKeyBuilder(
      keysOf({ keepQueryValues: ['owner', 'ref'], origins: { 'https://api.example.com': 'api' } }),
      BASE,
    );
    for (let t = 0; t < 1000; t++) {
      const marker = `Zq${g.pick(DIGITS, 2)}${g.pick(ALNUM, 22)}`;
      const markers = [marker, ids.uuid(), ids.hex(), ids.number().padStart(4, '9')];
      const email = `${marker.toLowerCase()}@example.com`;
      const host = g.int(2) === 0 ? 'app.example.com' : 'api.example.com';
      const url =
        `https://user${marker}:pw${marker}@${host}/api/${markers[0]}/x/${markers[1]}/` +
        `${markers[2]}/${markers[3]}/${encodeURIComponent(email)}` +
        `?q=${marker}&search=${encodeURIComponent(email)}&owner=${encodeURIComponent(email)}` +
        `&ref=${markers[1]}&${markers[3]}#${marker}`;
      const key = keyOf(builder({ method: 'GET', url, resourceType: 'fetch' }));
      for (const m of [...markers, email, 'https', 'user', 'pw']) {
        expect(key.toLowerCase()).not.toContain(m.toLowerCase());
      }
    }
  });
});

describe('stability (07-AC-04)', () => {
  test('07-AC-04 the same sample and config give the same key on every call and platform', () => {
    const url = 'https://app.example.com/api/Caf%C3%A9/42/a%2Fb?b=1&a=2&ids%5B0%5D=x#frag';
    const first = build(url);
    expect(first).toEqual(build(url));
    // Pinned value: the CI matrix runs this on every platform and Node version.
    expect(keyOf(first)).toBe('GET /api/Café/:id/a%2Fb?a&b&ids[]');
  });
});

describe('keyBuilder (07-REQ-15, 07-REQ-16)', () => {
  const run = (keyBuilder: KeyBuilder, url = 'https://app.example.com/api/tickets/42') =>
    createKeyBuilder(
      { ...keysOf(), keyBuilder },
      BASE,
    )({ method: 'get', url, resourceType: 'xhr' });

  test('07-AC-05 is called with the uppercase method, raw URL and resource type', () => {
    const calls: unknown[] = [];
    run((req) => {
      calls.push(req);
      return undefined;
    }, 'https://app.example.com/a b');
    expect(calls).toEqual([
      { method: 'GET', url: 'https://app.example.com/a b', resourceType: 'xhr', operation: null },
    ]);
  });

  test('07-AC-05 a non-empty string is the key, not trimmed and without the method added', () => {
    expect(run(() => ' custom key ')).toEqual({
      ok: true,
      key: ' custom key ',
      origin: 'https://app.example.com',
      label: '',
      issues: [],
    });
  });

  test('07-AC-05 undefined falls back to the built-in normalization without a warning', () => {
    expect(run(() => undefined)).toMatchObject({
      ok: true,
      key: 'GET /api/tickets/:id',
      issues: [],
    });
  });

  test.each([
    ['a number', 42],
    ['null', null],
    ['an object', { key: 'x' }],
    ['an empty string', ''],
    ['a blank string', ' \n\t'],
  ])('07-AC-05 %s falls back with NORMALIZE_KEY_BUILDER_INVALID', (_name, value) => {
    const result = run(() => value as unknown as string);
    expect(result).toMatchObject({ ok: true, key: 'GET /api/tickets/:id' });
    expect(result.issues.map((i) => i.code)).toEqual(['NORMALIZE_KEY_BUILDER_INVALID']);
  });

  test('07-AC-05 an exception falls back with NORMALIZE_KEY_BUILDER_THREW and its message', () => {
    const result = run(() => {
      throw new Error('boom 123');
    });
    expect(result).toMatchObject({ ok: true, key: 'GET /api/tickets/:id' });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe('NORMALIZE_KEY_BUILDER_THREW');
    expect(result.issues[0]?.message).toContain('boom 123');
    const thrownString = run(() => {
      throw 'plain';
    });
    expect(thrownString.issues[0]?.message).toContain('plain');
  });

  test('07-AC-05 repeated warnings of one code collapse into one entry with count', () => {
    const issues = [1, 2, 3].flatMap((i) => [
      ...run(() => i as unknown as string, `https://app.example.com/x/${i}`).issues,
      ...run(() => {
        throw new Error('same');
      }).issues,
      ...build(`data:text/plain,${i}`).issues,
    ]);
    expect(collapseIssues(issues).map((i) => [i.code, i.count])).toEqual([
      ['NORMALIZE_KEY_BUILDER_INVALID', 3],
      ['NORMALIZE_KEY_BUILDER_THREW', 3],
      ['NORMALIZE_UNSUPPORTED_URL', 3],
    ]);
  });

  test('07-AC-05 a fallback for an unsupported URL skips the sample', () => {
    const result = run(() => {
      throw new Error('x');
    }, 'blob:https://app.example.com/1');
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toEqual([
      'NORMALIZE_KEY_BUILDER_THREW',
      'NORMALIZE_UNSUPPORTED_URL',
    ]);
  });
});

describe('origin and label (07-REQ-03, 07-REQ-23)', () => {
  const custom: KeyBuilder = () => 'custom';

  test('07-AC-10 a keyBuilder key keeps the origin and label parsed from the URL', () => {
    const at = (keys: PerfConfigInput['keys'], ctx = BASE) =>
      createKeyBuilder(
        { ...keysOf(keys), keyBuilder: custom },
        ctx,
      )({
        method: 'GET',
        url: 'https://API.example.com:443/x',
        resourceType: 'fetch',
      });
    expect(at({})).toEqual({
      ok: true,
      key: 'custom',
      origin: 'https://api.example.com',
      label: 'api.example.com',
      issues: [],
    });
    expect(at({ origins: { 'https://api.example.com': 'api' } })).toMatchObject({ label: 'api' });
    expect(at({}, { baseOrigins: ['https://api.example.com/'] })).toMatchObject({ label: '' });
  });

  test('07-AC-10 an unparsable URL with a keyBuilder key has origin and label null', () => {
    for (const url of ['not a url', 'data:text/plain,x']) {
      const result = createKeyBuilder(
        { ...keysOf(), keyBuilder: custom },
        BASE,
      )({
        method: 'GET',
        url,
        resourceType: 'fetch',
      });
      expect(result).toEqual({ ok: true, key: 'custom', origin: null, label: null, issues: [] });
    }
  });

  test('built-in keys report the canonical origin and label', () => {
    expect(build('https://APP.example.com:443/x')).toMatchObject({
      origin: 'https://app.example.com',
      label: '',
    });
    expect(build('http://[::1]:8080/x', {}, { baseOrigins: [] })).toMatchObject({
      origin: 'http://[::1]:8080',
      label: '[::1]:8080',
    });
  });
});

describe('truncation (07-REQ-18)', () => {
  test('07-AC-06 a key longer than 2000 UTF-16 units is cut to 2000 with a stable hash', () => {
    expect(MAX_KEY_LENGTH).toBe(2000);
    const url = `https://app.example.com/${'segment/'.repeat(400)}end`;
    const first = build(url);
    expect(first.ok).toBe(true);
    const key = keyOf(first);
    expect(key).toHaveLength(2000);
    expect(key).toMatch(/…~[0-9a-f]{14}$/);
    expect(key.startsWith(`GET /${'segment/'.repeat(10)}`)).toBe(true);
    expect(first.issues.map((i) => i.code)).toEqual(['NORMALIZE_KEY_TRUNCATED']);
    expect(build(url)).toEqual(first);
    // Keys differing only after the cut keep different hashes.
    expect(keyOf(build(`${url}2`))).not.toBe(key);
  });

  test('07-AC-06 a cut inside a surrogate pair gives 1999 units', () => {
    const long = `${'x'.repeat(1983)}😀${'y'.repeat(100)}`;
    const result = createKeyBuilder(
      { ...keysOf(), keyBuilder: () => long },
      BASE,
    )({
      method: 'GET',
      url: 'https://app.example.com/',
      resourceType: 'fetch',
    });
    const key = keyOf(result);
    expect(key).toHaveLength(1999);
    expect(key.startsWith('x'.repeat(1983) + '…~')).toBe(true);
    expect(result.issues.map((i) => i.code)).toEqual(['NORMALIZE_KEY_TRUNCATED']);
  });

  test('07-AC-06 a key of exactly 2000 units is kept', () => {
    const exact = 'k'.repeat(2000);
    const result = createKeyBuilder(
      { ...keysOf(), keyBuilder: () => exact },
      BASE,
    )({
      method: 'GET',
      url: 'https://app.example.com/',
      resourceType: 'fetch',
    });
    expect(result).toMatchObject({ ok: true, key: exact, issues: [] });
  });
});
