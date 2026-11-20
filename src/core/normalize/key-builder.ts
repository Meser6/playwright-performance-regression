// Endpoint keys from raw requests (07, chapters 4–9 and 11).
import type { ResolvedConfig } from '../config/index.ts';
import { hashHex } from '../random/index.ts';
import type { Issue, RawRequestSample } from '../types/index.ts';
import { MAX_KEY_LENGTH } from './constants.ts';
import { compileIdMatcher } from './patterns.ts';
import type { IdMatcher } from './patterns.ts';

/** NORMALIZE_* warnings; collected and collapsed by the reporter (02-REQ-20). */
export type NormalizeIssue = Issue;

export interface KeyBuilderContext {
  /** Origins of use.baseURL of measured projects only; get the empty label (07-REQ-03, 07-REQ-20). */
  baseOrigins: readonly string[];
}

export type KeyResult =
  // origin: canonical origin of the URL; label: its label (07-REQ-03); both feed report.origins.
  // null only for a keyBuilder key whose URL could not be parsed (07-REQ-23).
  | { ok: true; key: string; origin: string | null; label: string | null; issues: NormalizeIssue[] }
  | { ok: false; issues: NormalizeIssue[] };

export type KeySample = Pick<RawRequestSample, 'method' | 'url' | 'resourceType'>;

const HINT_EXTEND = 'Use keys.extraIdPatterns or keys.keyBuilder for ids in other formats.';

/** Parses an http(s) URL; null for anything else (07-REQ-19). */
function parseHttpUrl(text: string): URL | null {
  if (!URL.canParse(text)) return null;
  const url = new URL(text);
  return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
}

/** Canonical WHATWG origin of an http(s) URL or origin text; null when it is not one. */
export function canonicalOrigin(text: string): string | null {
  return parseHttpUrl(text)?.origin ?? null;
}

/** Unique canonical origins, sorted by UTF-16 code units; invalid entries are dropped. */
export function canonicalOrigins(origins: readonly string[]): string[] {
  const set = new Set<string>();
  for (const origin of origins) {
    const canonical = canonicalOrigin(origin);
    if (canonical !== null) set.add(canonical);
  }
  return [...set].sort();
}

// Characters percent-encoded in parts of the key (07-REQ-06, 07-REQ-13).
/* eslint-disable no-control-regex */
const SEGMENT_ESCAPE = /[%/?#& \u0000-\u001f\u007f-\u009f]/g;
const NAME_ESCAPE = /[%&=# \u0000-\u001f\u007f-\u009f]/g;
const VALUE_ESCAPE = /[%&=#, \u0000-\u001f\u007f-\u009f]/g;
/* eslint-enable no-control-regex */
const escape = (text: string, chars: RegExp): string => text.replace(chars, encodeURIComponent);

function normalizePath(pathname: string, matchId: IdMatcher): string {
  const segments: string[] = [];
  for (const raw of pathname.split('/')) {
    const segment = raw.split(';', 1)[0] ?? '';
    if (segment === '') continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      segments.push(segment);
      continue;
    }
    segments.push(matchId(decoded) ?? escape(decoded, SEGMENT_ESCAPE));
  }
  return `/${segments.join('/')}`;
}

function normalizeQuery(
  params: URLSearchParams,
  keys: ResolvedConfig['keys'],
  matchId: IdMatcher,
): string {
  const drop = new Set(keys.dropQueryParams);
  const keep = new Set(keys.keepQueryValues);
  const names = new Map<string, Set<string> | null>();
  for (const [rawName, value] of params) {
    const name = rawName.replace(/\[[0-9]+\]/g, '[]');
    if (name === '' || drop.has(name) || matchId(name) !== null) continue;
    const encoded = escape(name, NAME_ESCAPE);
    if (!keep.has(name)) {
      if (!names.has(encoded)) names.set(encoded, null);
      continue;
    }
    const values = names.get(encoded) ?? new Set<string>();
    values.add(matchId(value) ?? escape(value, VALUE_ESCAPE));
    names.set(encoded, values);
  }
  // Default sort compares UTF-16 code units (07-REQ-13).
  return [...names.keys()]
    .sort()
    .map((name) => {
      const values = names.get(name);
      return values ? `${name}=${[...values].sort().join(',')}` : name;
    })
    .join('&');
}

/** Cuts a key longer than MAX_KEY_LENGTH and appends a hash of the whole key (07-REQ-18). */
export function truncateKey(key: string): string {
  if (key.length <= MAX_KEY_LENGTH) return key;
  const suffix = `…~${hashHex(key)}`;
  let cut = MAX_KEY_LENGTH - suffix.length;
  const before = key.charCodeAt(cut - 1);
  const after = key.charCodeAt(cut);
  if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) cut -= 1;
  return key.slice(0, cut) + suffix;
}

/**
 * Compiles the `keys` config once and returns a pure function from a request sample to its
 * endpoint key (07, chapter 12). Collecting and collapsing warnings is up to the caller.
 */
export function createKeyBuilder(
  cfg: ResolvedConfig['keys'],
  ctx: KeyBuilderContext,
): (sample: KeySample) => KeyResult {
  const matchId = compileIdMatcher(cfg);
  const labels = new Map<string, string>();
  for (const origin of canonicalOrigins(ctx.baseOrigins)) labels.set(origin, '');
  // keys.origins wins over baseOrigins (07-REQ-03).
  for (const [origin, label] of Object.entries(cfg.origins)) {
    const canonical = canonicalOrigin(origin);
    if (canonical !== null) labels.set(canonical, label);
  }
  const keyBuilder = cfg.keyBuilder;

  return (sample) => {
    const method = sample.method.toUpperCase();
    const url = parseHttpUrl(sample.url);
    const issues: NormalizeIssue[] = [];
    let key: string | undefined;

    if (keyBuilder !== undefined) {
      let built: unknown;
      try {
        built = keyBuilder({ method, url: sample.url, resourceType: sample.resourceType });
      } catch (error) {
        issues.push({
          code: 'NORMALIZE_KEY_BUILDER_THREW',
          message: `keys.keyBuilder threw an exception: ${error instanceof Error ? error.message : String(error)}. The built-in normalization was used instead.`,
          hint: 'Fix the keyBuilder function; it must not throw.',
        });
        built = undefined;
      }
      if (typeof built === 'string' && built.trim() !== '') {
        key = built;
      } else if (built !== undefined) {
        issues.push({
          code: 'NORMALIZE_KEY_BUILDER_INVALID',
          message:
            'keys.keyBuilder returned a value that is neither a non-empty string nor undefined. The built-in normalization was used instead.',
          hint: 'Return the whole key as a non-empty string, or undefined for the built-in normalization.',
        });
      }
    }

    if (key === undefined) {
      if (url === null) {
        issues.push({
          code: 'NORMALIZE_UNSUPPORTED_URL',
          message:
            'A request URL could not be parsed or does not use http/https; the sample was skipped.',
        });
        return { ok: false, issues };
      }
      const label = labels.get(url.origin) ?? url.host;
      const query = cfg.query === 'names' ? normalizeQuery(url.searchParams, cfg, matchId) : '';
      key = `${method} ${label}${normalizePath(url.pathname, matchId)}${query === '' ? '' : `?${query}`}`;
    }

    const truncated = truncateKey(key);
    if (truncated !== key) {
      issues.push({
        code: 'NORMALIZE_KEY_TRUNCATED',
        message: `An endpoint key longer than ${MAX_KEY_LENGTH} characters was truncated and suffixed with its hash.`,
        hint: HINT_EXTEND,
      });
    }
    return {
      ok: true,
      key: truncated,
      origin: url?.origin ?? null,
      label: url === null ? null : (labels.get(url.origin) ?? url.host),
      issues,
    };
  };
}
