// Request filters (05, chapter 5.2). Pure: no Playwright objects, only plain request data.
import type { ResolvedConfig, ResolvedUrlPattern } from '../core/config/index.ts';
import { KNOWN_THIRD_PARTY_HOSTS } from './constants.ts';

/** Plain request data the filters need. */
export interface FilterInput {
  url: string;
  resourceType: string;
  /** The request was started by a service worker (05-REQ-05). */
  isServiceWorker: boolean;
}

/**
 * True when `host` is a listed host or a subdomain of one (05, chapter 5.3):
 * www.google-analytics.com matches google-analytics.com, notgoogle-analytics.com does not.
 */
export function isKnownThirdPartyHost(
  host: string,
  hosts: readonly string[] = KNOWN_THIRD_PARTY_HOSTS,
): boolean {
  const name = host.toLowerCase().replace(/\.$/u, '');
  return hosts.some((entry) => name === entry || name.endsWith(`.${entry}`));
}

/** A text pattern is a case-sensitive substring, a RegExp is tested (05-REQ-08; 03, chapter 5). */
export function matchesUrlPattern(url: string, pattern: ResolvedUrlPattern): boolean {
  return typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url);
}

/** True when the path (no query or fragment, lowercase) ends with a listed extension (05-REQ-07). */
function hasIgnoredExtension(url: URL, extensions: readonly string[]): boolean {
  const path = url.pathname.toLowerCase();
  return extensions.some((extension) => path.endsWith(extension));
}

/**
 * Whether the collector tracks a request: the filter steps of 05, chapter 5.2, in order, after
 * skipping requests started by a service worker (05-REQ-05).
 */
export function shouldTrack(req: FilterInput, measure: ResolvedConfig['measure']): boolean {
  if (req.isServiceWorker) return false;
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (!(measure.resourceTypes as readonly string[]).includes(req.resourceType)) return false;
  if (req.resourceType !== 'document' && hasIgnoredExtension(url, measure.ignoreExtensions)) {
    return false;
  }
  return passesUrlFilters(req.url, url, measure);
}

/** include, exclude and excludeKnownThirdParty (05, chapter 5.2, steps 4–6). */
function passesUrlFilters(text: string, url: URL, measure: ResolvedConfig['measure']): boolean {
  if (
    measure.include.length > 0 &&
    !measure.include.some((pattern) => matchesUrlPattern(text, pattern))
  ) {
    return false;
  }
  if (measure.exclude.some((pattern) => matchesUrlPattern(text, pattern))) return false;
  if (measure.excludeKnownThirdParty && isKnownThirdPartyHost(url.hostname)) return false;
  return true;
}

/**
 * Whether an APIRequestContext call is measured (15-REQ-06): an http(s) URL that passes include,
 * exclude and excludeKnownThirdParty; resourceTypes and ignoreExtensions do not apply.
 */
export function shouldTrackApiCall(text: string, measure: ResolvedConfig['measure']): boolean {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return passesUrlFilters(text, url, measure);
}
