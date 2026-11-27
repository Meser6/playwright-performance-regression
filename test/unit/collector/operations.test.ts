// Operation names of keys.operations (18): the extractors on the golden cases, the key built from
// them, the API call body and the option itself.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { apiOperationBody, urlWithParams } from '../../../src/collector/api-requests.ts';
import { OPERATION_BODY_LIMIT } from '../../../src/collector/constants.ts';
import { readOperation, stripGraphqlNoise } from '../../../src/collector/operations.ts';
import type { OperationBody } from '../../../src/collector/operations.ts';
import { resolveConfig } from '../../../src/core/config/index.ts';
import type { PerfConfigInput, ResolvedConfig } from '../../../src/core/config/index.ts';
import {
  createKeyBuilder,
  detectKeyExplosion,
  normalizationFingerprint,
  operationKeyPart,
} from '../../../src/core/normalize/index.ts';

type JsonPattern = string | { regex: string; flags?: string };
interface Entry {
  type: 'graphql' | 'trpc';
  match: JsonPattern;
}
interface Case {
  name: string;
  entry: Entry | Entry[];
  method: string;
  url: string;
  body?: string | { text: string; padTo: number; padChar: string; suffix: string };
  names: string[] | null | 'unmatched';
  key: string;
}

const cases = (
  JSON.parse(
    readFileSync(join(import.meta.dirname, '../../golden/operations/cases.json'), 'utf8'),
  ) as { cases: Case[] }
).cases;

function keysOf(input: PerfConfigInput['keys'] = {}): ResolvedConfig['keys'] {
  const result = resolveConfig({ keys: input }, {});
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value.config.keys;
}

function bodyOf(c: Case): string | null {
  if (c.body === undefined) return null;
  if (typeof c.body === 'string') return c.body;
  const pad = c.body.padTo - c.body.text.length - c.body.suffix.length;
  return c.body.text + c.body.padChar.repeat(pad) + c.body.suffix;
}

const BASE = { baseOrigins: ['https://app.example'] };

describe('operation extractors (18, chapter 5)', () => {
  test('the golden file covers every row of the tables', () => {
    expect(cases.length).toBeGreaterThanOrEqual(50);
    expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
  });

  test.each(cases)('18-AC-01 $name', (c) => {
    const keys = keysOf({ operations: (Array.isArray(c.entry) ? c.entry : [c.entry]) as never });
    let reads = 0;
    const text = bodyOf(c);
    const result = readOperation(keys.operations, {
      method: c.method,
      url: c.url,
      body: () => {
        reads += 1;
        return text === null ? null : { text };
      },
    });
    const names = result.matched ? result.names : 'unmatched';
    expect(names).toEqual(c.names);
    // The body is read only for POST requests matching a graphql entry (18-REQ-07).
    const readsBody = result.matched && result.entry.type === 'graphql' && c.method === 'POST';
    expect(reads).toBe(readsBody ? 1 : 0);
    const keyOf = createKeyBuilder(keys, BASE);
    const built = keyOf({
      method: c.method,
      url: c.url,
      resourceType: 'fetch',
      operation: Array.isArray(names) ? names : null,
    });
    expect(built.ok && built.key).toBe(c.key);
  });

  test('18-AC-01 the cut is at 65 536 characters', () => {
    expect(OPERATION_BODY_LIMIT).toBe(65_536);
  });

  test('comments and string literals are removed from the query', () => {
    expect(stripGraphqlNoise('a # c\nb "s \\" t" """x\ny""" d').replace(/\s+/gu, ' ')).toBe(
      'a b d',
    );
  });

  test('an empty keys.operations reads nothing', () => {
    const result = readOperation([], {
      method: 'POST',
      url: 'https://app.example/graphql',
      body: () => {
        throw new Error('read');
      },
    });
    expect(result).toEqual({ matched: false });
  });
});

describe('operation keys (18-REQ-06, 18-REQ-10)', () => {
  test('operationKeyPart sorts by UTF-16 code units, drops duplicates and counts after 10', () => {
    expect(operationKeyPart(['b', 'B', 'a', 'B'])).toBe('B+a+b');
    const many = Array.from({ length: 12 }, (_, i) => `n${String(i).padStart(2, '0')}`);
    expect(operationKeyPart(many)).toBe(`${many.slice(0, 10).join('+')}+…(12)`);
  });

  test('18-AC-06 a request call gets the prefix and the operation part', () => {
    const keys = keysOf({ operations: [{ type: 'graphql', match: '/graphql' }] });
    const keyOf = createKeyBuilder(keys, BASE);
    const built = keyOf({
      method: 'POST',
      url: 'https://app.example/graphql',
      resourceType: 'request',
      operation: ['X'],
    });
    expect(built.ok && built.key).toBe('POST /graphql#X');
  });

  test('18-REQ-10 keyBuilder gets the names and wins; undefined falls back to the operation key', () => {
    const seen: unknown[] = [];
    const keys = {
      ...keysOf({ operations: [{ type: 'graphql', match: '/graphql' }] }),
      keyBuilder: (req: { operation: readonly string[] | null; url: string }) => {
        seen.push(req.operation);
        return req.url.endsWith('/own') ? 'own key' : undefined;
      },
    };
    const keyOf = createKeyBuilder(keys, BASE);
    const sample = { method: 'POST', resourceType: 'fetch', operation: ['B', 'A'] as const };
    expect(keyOf({ ...sample, url: 'https://app.example/graphql/own' })).toMatchObject({
      key: 'own key',
    });
    expect(keyOf({ ...sample, url: 'https://app.example/graphql' })).toMatchObject({
      key: 'POST /graphql#A+B',
    });
    expect(
      keyOf({ method: 'GET', url: 'https://app.example/x', resourceType: 'fetch' }),
    ).toMatchObject({ key: 'GET /x' });
    expect(seen).toEqual([['B', 'A'], ['B', 'A'], null]);
  });

  test('the length limit covers the operation part (07-REQ-18)', () => {
    const keys = keysOf({ operations: [{ type: 'graphql', match: '/graphql' }] });
    const long = Array.from(
      { length: 10 },
      (_, i) => `${String.fromCharCode(65 + i)}${'x'.repeat(99)}`,
    );
    const built = createKeyBuilder(
      keys,
      BASE,
    )({
      method: 'POST',
      url: `https://app.example/${'p/'.repeat(800)}graphql`,
      resourceType: 'fetch',
      operation: long,
    });
    expect(built.ok && built.key.length).toBe(2000);
    expect(built.issues.map((i) => i.code)).toEqual(['NORMALIZE_KEY_TRUNCATED']);
  });

  test('operations of one endpoint are not a key explosion (07-REQ-22)', () => {
    const keys = Array.from({ length: 12 }, (_, i) => `POST /graphql#Op${String(i)}`);
    expect(detectKeyExplosion(keys)).toEqual([]);
    const ids = Array.from({ length: 12 }, (_, i) => `GET /t/v${String(i)}x/items#A`);
    expect(detectKeyExplosion(ids).map((i) => i.code)).toEqual(['NORMALIZE_HIGH_CARDINALITY']);
  });
});

describe('normalization fingerprint (18-REQ-11)', () => {
  test('18-AC-05 without keys.operations the fingerprint is the one of 1.0.x', () => {
    // Values computed by 1.0.1 for the default config.
    expect(normalizationFingerprint(keysOf(), { baseOrigins: [] })).toBe('1be5f2f3d77e9e');
    expect(normalizationFingerprint(keysOf(), { baseOrigins: ['http://localhost:3000'] })).toBe(
      '0c7d96eded89c4',
    );
    const keyOf = createKeyBuilder(keysOf(), BASE);
    expect(
      keyOf({ method: 'POST', url: 'https://app.example/graphql?x=1', resourceType: 'fetch' }),
    ).toMatchObject({ key: 'POST /graphql?x' });
  });

  test('enabling or changing keys.operations changes the fingerprint', () => {
    const none = normalizationFingerprint(keysOf(), BASE);
    const graphql = normalizationFingerprint(
      keysOf({ operations: [{ type: 'graphql', match: '/graphql' }] }),
      BASE,
    );
    const regex = normalizationFingerprint(
      keysOf({ operations: [{ type: 'graphql', match: /\/graphql/u }] }),
      BASE,
    );
    expect(new Set([none, graphql, regex]).size).toBe(3);
  });
});

describe('API call bodies (15-REQ-20)', () => {
  const keys = keysOf({ operations: [{ type: 'graphql', match: '/graphql' }] });
  const read = (method: string, url: string, options: unknown): unknown => {
    const result = readOperation(keys.operations, {
      method,
      url: method === 'GET' ? urlWithParams(url, options) : url,
      body: () => apiOperationBody(options),
    });
    return result.matched ? result.names : 'unmatched';
  };

  test('data as an object, as JSON text, multipart operations and GET params', () => {
    const url = 'https://app.example/graphql';
    expect(read('POST', url, { data: { operationName: 'X', query: '{ a }' } })).toEqual(['X']);
    expect(read('POST', url, { data: [{ operationName: 'B' }, { operationName: 'A' }] })).toEqual([
      'B',
      'A',
    ]);
    expect(read('POST', url, { data: '{"query":"query Y { a }"}' })).toEqual(['Y']);
    expect(
      read('POST', url, { multipart: { operations: '{"query":"mutation U { u }"}', map: '{}' } }),
    ).toEqual(['U']);
    expect(read('GET', url, { params: { operationName: 'G', query: '{ a }' } })).toEqual(['G']);
    expect(read('GET', url, { params: 'query=query%20S%20%7B%20a%20%7D' })).toEqual(['S']);
    expect(read('GET', url, { params: new URLSearchParams({ operationName: 'P' }) })).toEqual([
      'P',
    ]);
    expect(read('POST', url, { data: Buffer.from('{}') })).toBeNull();
    expect(read('POST', url, undefined)).toBeNull();
  });

  test('the body kinds', () => {
    const kinds: [unknown, OperationBody][] = [
      [{ data: 'text' }, { text: 'text' }],
      [{ data: { a: 1 } }, { value: { a: 1 } }],
      [{ multipart: { operations: 'x' } }, { multipartOperations: 'x' }],
      [{ form: { a: 1 } }, null],
      ['nope', null],
    ];
    for (const [options, body] of kinds) expect(apiOperationBody(options)).toEqual(body);
    expect(urlWithParams('https://a.example/g?x=1', { params: { y: 2 } })).toBe(
      'https://a.example/g?x=1&y=2',
    );
    expect(urlWithParams('not a url', { params: { y: 2 } })).toBe('not a url');
  });
});

describe('config (18-REQ-01)', () => {
  const issues = (input: PerfConfigInput): string[] => {
    const result = resolveConfig(input, {});
    return result.ok ? [] : result.issues.map((i) => `${i.code} ${i.path ?? ''}`);
  };

  test('default [] and the snapshot keeps the JSON form', () => {
    const empty = resolveConfig({}, {});
    expect(empty.ok && empty.value.snapshot.keys.operations).toEqual([]);
    const result = resolveConfig(
      { keys: { operations: [{ type: 'trpc', match: /^\/api\/trpc\//gu }] } },
      {},
    );
    if (!result.ok) throw new Error('invalid');
    expect(result.value.snapshot.keys.operations).toEqual([
      { type: 'trpc', match: { regex: '^\\/api\\/trpc\\/', flags: 'gu' } },
    ]);
    // g and y are dropped when compiling (03, chapter 5).
    expect(result.value.config.keys.operations[0]?.match).toEqual(/^\/api\/trpc\//u);
  });

  test('an unknown type, a bad pattern and an unknown field are config errors', () => {
    expect(issues({ keys: { operations: [{ type: 'grpc' as never, match: '/x' }] } })).toEqual([
      'CONFIG_INVALID_VALUE keys.operations[0].type',
    ]);
    expect(issues({ keys: { operations: [{ type: 'graphql', match: { regex: '(' } }] } })).toEqual([
      'CONFIG_INVALID_REGEX keys.operations[0].match',
    ]);
    expect(
      issues({ keys: { operations: [{ type: 'graphql', match: '/g', mtch: 1 } as never] } }),
    ).toEqual(['CONFIG_UNKNOWN_OPTION keys.operations[0].mtch']);
    expect(issues({ keys: { operations: [{ type: 'graphql' } as never] } })).toEqual([
      'CONFIG_INVALID_VALUE keys.operations[0]',
    ]);
  });

  test('the type error lists the types', () => {
    const result = resolveConfig(
      { keys: { operations: [{ type: 'grpc' as never, match: '/x' }] } },
      {},
    );
    expect(!result.ok && result.issues[0]?.message).toMatch(/graphql.*trpc/u);
  });
});
