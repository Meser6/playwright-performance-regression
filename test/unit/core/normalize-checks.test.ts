// Normalization fingerprint, base origins and key explosion (07-REQ-20 – 07-REQ-22).
import { describe, expect, test } from 'vitest';
import { resolveConfig } from '../../../src/core/config/index.ts';
import type { PerfConfigInput, ResolvedConfig } from '../../../src/core/config/index.ts';
import {
  CARDINALITY_MIN_KEYS,
  MAX_KEYS_WARNING,
  NORMALIZE_RULES_VERSION,
  createKeyBuilder,
  detectKeyExplosion,
  measuredBaseOrigins,
  normalizationFingerprint,
} from '../../../src/core/normalize/index.ts';

function config(input: PerfConfigInput = {}): ResolvedConfig {
  const result = resolveConfig(input, {});
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value.config;
}

function keysOf(input: PerfConfigInput['keys'] = {}): ResolvedConfig['keys'] {
  return config({ keys: input }).keys;
}

const BASE = { baseOrigins: ['https://app.example.com'] };

describe('base origins (07-REQ-20)', () => {
  test('07-AC-11 baseOrigins come from measured projects only, unique, canonical, sorted', () => {
    const projects = [
      { role: 'measured', baseURL: 'https://APP.example.com/app/' },
      { role: 'measured', baseURL: 'https://app.example.com:443' },
      { role: 'measured', baseURL: 'http://localhost:3000' },
      { role: 'measured', baseURL: undefined },
      { role: 'measured', baseURL: 'not a url' },
      { role: 'dependency', baseURL: 'https://login.example.com' },
      { role: 'teardown', baseURL: 'https://cleanup.example.com' },
    ] as const;
    const measuredOnly = projects.filter((p) => p.role === 'measured');
    expect(measuredBaseOrigins(projects)).toEqual([
      'http://localhost:3000',
      'https://app.example.com',
    ]);
    const keys = keysOf();
    expect(normalizationFingerprint(keys, { baseOrigins: measuredBaseOrigins(projects) })).toBe(
      normalizationFingerprint(keys, { baseOrigins: measuredBaseOrigins(measuredOnly) }),
    );
  });
});

describe('key explosion (07-REQ-22)', () => {
  const dated = (n: number) =>
    Array.from(
      { length: n },
      (_, i) => `GET /api/reports/2026-11-${String(i + 1).padStart(2, '0')}/x`,
    );

  test('07-AC-07 20 keys differing in the third segment give one warning', () => {
    expect(CARDINALITY_MIN_KEYS).toBe(10);
    const issues = detectKeyExplosion([...dated(20), 'GET /api/other', 'POST /api/reports/a/x']);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('NORMALIZE_HIGH_CARDINALITY');
    expect(issues[0]?.message).toContain('GET /api/reports/*/x');
    expect(issues[0]?.message).toContain('20');
    expect(issues[0]?.hint).toMatch(/extraIdPatterns/);
    expect(issues[0]?.hint).toMatch(/keyBuilder/);
  });

  test('07-AC-07 9 such keys give no warning', () => {
    expect(detectKeyExplosion(dated(9))).toEqual([]);
  });

  test('groups are split by method, label and query; output is sorted and order-independent', () => {
    const keys = [
      ...dated(10),
      ...dated(10).map((k) => k.replace('GET /', 'GET api/')),
      ...dated(10).map((k) => `${k}?page`),
      ...dated(5).map((k) => k.replace('GET', 'POST')),
    ];
    const issues = detectKeyExplosion(keys);
    expect(issues.map((i) => i.message.match(/GET \S+/)?.[0])).toEqual([
      'GET /api/reports/*/x',
      'GET /api/reports/*/x?page',
      'GET api/api/reports/*/x',
    ]);
    expect(detectKeyExplosion([...keys].reverse())).toEqual(issues);
    expect(detectKeyExplosion([...keys, ...keys])).toEqual(issues);
  });

  test('more than 1000 endpoint keys give NORMALIZE_TOO_MANY_KEYS', () => {
    expect(MAX_KEYS_WARNING).toBe(1000);
    const keys = (n: number) => Array.from({ length: n }, (_, i) => `GET /k${i}/a${i}/b${i % 7}`);
    expect(detectKeyExplosion(keys(1000)).map((i) => i.code)).not.toContain(
      'NORMALIZE_TOO_MANY_KEYS',
    );
    expect(detectKeyExplosion(keys(1001)).map((i) => i.code)).toContain('NORMALIZE_TOO_MANY_KEYS');
  });

  test('keys in another format (from keyBuilder) are ignored', () => {
    expect(detectKeyExplosion(Array.from({ length: 20 }, (_, i) => `op${i}`))).toEqual([]);
  });
});

describe('normalization fingerprint (07-REQ-21)', () => {
  const fp = (keys: PerfConfigInput['keys'] = {}, ctx = BASE) =>
    normalizationFingerprint(keysOf(keys), ctx);

  test('07-AC-08 changing any keys option or baseOrigins changes the fingerprint', () => {
    expect(NORMALIZE_RULES_VERSION).toBe(1);
    const variants: [string, string][] = [
      ['default', fp()],
      ['origins', fp({ origins: { 'https://api.example.com': 'api' } })],
      ['idPatterns.number', fp({ idPatterns: { number: false } })],
      ['idPatterns.uuid', fp({ idPatterns: { uuid: false } })],
      ['idPatterns.hex', fp({ idPatterns: { hex: false } })],
      ['idPatterns.token', fp({ idPatterns: { token: false } })],
      ['idPatterns.mixed', fp({ idPatterns: { mixed: false } })],
      ['idPatterns.email', fp({ idPatterns: { email: false } })],
      ['extraIdPatterns string', fp({ extraIdPatterns: ['me'] })],
      ['extraIdPatterns regex', fp({ extraIdPatterns: [/^me$/] })],
      ['extraIdPatterns regex flags', fp({ extraIdPatterns: [/^me$/i] })],
      ['query', fp({ query: 'ignore' })],
      ['keepQueryValues', fp({ keepQueryValues: ['type'] })],
      ['dropQueryParams', fp({ dropQueryParams: ['_'] })],
      ['keyBuilder', normalizationFingerprint({ ...keysOf(), keyBuilder: () => undefined }, BASE)],
      ['baseOrigins', fp({}, { baseOrigins: ['https://other.example.com'] })],
      ['no baseOrigins', fp({}, { baseOrigins: [] })],
    ];
    expect(new Set(variants.map(([, v]) => v)).size).toBe(variants.length);
  });

  test('07-AC-08 the same config gives the same fingerprint on every call and platform', () => {
    expect(fp()).toBe(fp());
    // Equivalent spellings of baseOrigins give the same fingerprint.
    expect(
      fp({}, { baseOrigins: ['https://APP.example.com:443/', 'https://app.example.com'] }),
    ).toBe(fp());
    // Pinned value: the CI matrix runs this on every platform and Node version.
    expect(fp()).toBe(PINNED_DEFAULT_FINGERPRINT);
  });

  test('07-AC-09 the fingerprint is 14 lowercase hex digits and ignores advanced.seed', () => {
    for (let i = 0; i < 200; i++) {
      expect(fp({ dropQueryParams: [`p${i}`] })).toMatch(/^[0-9a-f]{14}$/);
    }
    const seeded = (seed: number) =>
      normalizationFingerprint(config({ advanced: { seed } } as PerfConfigInput).keys, BASE);
    expect(seeded(1)).toBe(seeded(987654));
    expect(seeded(1)).toBe(fp());
  });

  test('07-AC-09 a fingerprint with fewer significant digits is zero-padded', () => {
    let padded: string | undefined;
    for (let i = 0; padded === undefined && i < 10_000; i++) {
      const value = fp({ dropQueryParams: [`p${i}`] });
      if (value.startsWith('0')) padded = value;
    }
    expect(padded).toMatch(/^0[0-9a-f]{13}$/);
  });

  test('the keyBuilder body does not change the fingerprint', () => {
    expect(normalizationFingerprint({ ...keysOf(), keyBuilder: () => 'a' }, BASE)).toBe(
      normalizationFingerprint({ ...keysOf(), keyBuilder: () => 'b' }, BASE),
    );
  });
});

const PINNED_DEFAULT_FINGERPRINT = '1171addebdc560';

describe('host patterns in keys.origins (03-REQ-20, 07-REQ-25, 07-REQ-26)', () => {
  const resolve = (origins: Record<string, string>) => resolveConfig({ keys: { origins } }, {});

  test('03-AC-14 valid patterns, a duplicate after canonicalization and invalid ones', () => {
    expect(
      resolve({ 'https://*.ci.example.com': 'ci', 'https://app-*.example.com:8443': 'app' }).ok,
    ).toBe(true);
    expect(resolve({ 'HTTPS://*.CI.example.com:443/': 'ci' }).ok).toBe(true);
    const duplicate = resolve({
      'https://*.ci.example.com': 'a',
      'HTTPS://*.CI.example.com:443/': 'b',
    });
    expect(duplicate.ok ? [] : duplicate.issues.map((i) => i.code)).toEqual([
      'CONFIG_INVALID_VALUE',
    ]);
    for (const bad of [
      'https://*',
      'https://*.*',
      'https://example.*',
      'https://a**b.example.com',
      'https://*.example.com/api',
      'ftp://*.example.com',
      'https://*.example.com:*',
    ]) {
      const result = resolve({ [bad]: 'x' });
      expect(result.ok ? [] : result.issues.map((i) => i.code), bad).toEqual([
        'CONFIG_INVALID_VALUE',
      ]);
    }
    const shared = resolve({ 'https://*.ci.example.com': 'api', 'https://api.example.com': 'api' });
    expect(shared.ok && shared.value.warnings.map((w) => w.code)).toEqual([]);
  });

  test('07-AC-12 the order of the entries changes neither keys nor the fingerprint', () => {
    const a = { 'https://*.ci.example.com': 'ci', 'https://api-*.ci.example.com': 'api' };
    const b = { 'https://api-*.ci.example.com': 'api', 'https://*.ci.example.com': 'ci' };
    const keysA = config({ keys: { origins: a } }).keys;
    const keysB = config({ keys: { origins: b } }).keys;
    const url = 'https://api-12.ci.example.com/x';
    const build = (keys: ResolvedConfig['keys']) =>
      createKeyBuilder(keys, { baseOrigins: [] })({ method: 'GET', url, resourceType: 'fetch' });
    expect(build(keysA)).toEqual(build(keysB));
    expect(normalizationFingerprint(keysA, { baseOrigins: [] })).toBe(
      normalizationFingerprint(keysB, { baseOrigins: [] }),
    );
  });

  test('07-AC-13 random baseURL hosts covered by a pattern give the same fingerprint', () => {
    const covered = config({ keys: { origins: { 'https://*.ci.example.com': '' } } }).keys;
    const fp = (keys: ResolvedConfig['keys'], origin: string) =>
      normalizationFingerprint(keys, { baseOrigins: [origin] });
    expect(fp(covered, 'https://pr-1.ci.example.com')).toBe(
      fp(covered, 'https://pr-2.ci.example.com'),
    );
    const plain = config().keys;
    expect(fp(plain, 'https://pr-1.ci.example.com')).not.toBe(
      fp(plain, 'https://pr-2.ci.example.com'),
    );
  });

  test('07-AC-14 an IPv6 origin never matches; 10 000 origins against 50 patterns', () => {
    const origins = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [
        `https://p${String(i)}-*.ci.example.com`,
        `l${String(i)}`,
      ]),
    );
    const keys = config({ keys: { origins: { ...origins, 'http://*.localhost.test': 'x' } } }).keys;
    const build = createKeyBuilder(keys, { baseOrigins: [] });
    expect(
      build({ method: 'GET', url: 'http://[::1]:3000/a', resourceType: 'fetch' }),
    ).toMatchObject({
      key: 'GET [::1]:3000/a',
    });
    const batch = (): number => {
      const start = performance.now();
      for (let i = 0; i < 10_000; i++) {
        build({
          method: 'GET',
          url: `https://p${String(i % 50)}-${String(i)}.ci.example.com/x`,
          resourceType: 'fetch',
        });
      }
      return performance.now() - start;
    };
    // One warm-up batch (JIT), then the best of 5 batches: a single cold batch measured mostly the
    // compiler and the other workers on a busy runner (500–600 ms on Windows, 12-REQ-06: fixed,
    // not retried). The best batch still grows with a slower matching algorithm.
    batch();
    const best = Math.min(...Array.from({ length: 5 }, batch));
    expect(best).toBeLessThan(250);
  });
});
