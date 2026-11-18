import { describe, expect, test } from 'vitest';
import { perfDefaults, resolveConfig } from '../../../src/core/config/index.ts';
import type { PerfConfigInput, ResolvedConfig } from '../../../src/core/config/index.ts';
import { KNOWN_THIRD_PARTY_HOSTS } from '../../../src/collector/constants.ts';
import {
  isKnownThirdPartyHost,
  matchesUrlPattern,
  shouldTrack,
} from '../../../src/collector/filters.ts';

function measure(input: PerfConfigInput['measure'] = {}): ResolvedConfig['measure'] {
  const resolved = resolveConfig({ measure: input }, {});
  if (!resolved.ok) throw new Error('invalid test config');
  return resolved.value.config.measure;
}

const req = (url: string, resourceType = 'fetch', isServiceWorker = false) => ({
  url,
  resourceType,
  isServiceWorker,
});

describe('shouldTrack', () => {
  test('05-AC-04 filter table with the default config', () => {
    const m = perfDefaults.measure;
    const cases: [ReturnType<typeof req>, boolean][] = [
      // The extension is checked at the end of the path: .json passes although .js is listed.
      [req('http://app.test/api/data.json', 'xhr'), true],
      [req('http://app.test/app.js?v=1', 'xhr'), false],
      [req('http://app.test/static/app.js?v=3#x', 'fetch'), false],
      // A document passes even with an ignored extension.
      [req('http://app.test/index.html', 'document'), true],
      [req('http://app.test/index.html', 'fetch'), false],
      [req('data:application/json,{}', 'fetch'), false],
      [req('blob:http://app.test/1234', 'fetch'), false],
      [req('chrome-extension://abc/x', 'fetch'), false],
      [req('https://www.google-analytics.com/collect', 'fetch'), false],
      [req('https://notgoogle-analytics.com/collect', 'fetch'), true],
      [req('https://app.test/api/orders', 'fetch'), true],
    ];
    for (const [input, expected] of cases) {
      expect(shouldTrack(input, m), input.url).toBe(expected);
    }
  });

  test('skips resource types outside measure.resourceTypes', () => {
    const m = perfDefaults.measure;
    expect(shouldTrack(req('http://app.test/api', 'xhr'), m)).toBe(true);
    expect(shouldTrack(req('http://app.test/api', 'document'), m)).toBe(true);
    expect(shouldTrack(req('http://app.test/api', 'script'), m)).toBe(false);
    expect(shouldTrack(req('http://app.test/api', 'image'), m)).toBe(false);
    expect(shouldTrack(req('http://app.test/api', 'eventsource'), m)).toBe(false);
    expect(
      shouldTrack(
        req('http://app.test/api', 'eventsource'),
        measure({ resourceTypes: ['eventsource'] }),
      ),
    ).toBe(true);
  });

  test('skips requests started by a service worker (05-REQ-05)', () => {
    expect(shouldTrack(req('http://app.test/api', 'fetch', true), perfDefaults.measure)).toBe(
      false,
    );
  });

  test('applies include, then exclude, then the known third-party hosts (05-REQ-08)', () => {
    const m = measure({ include: ['/api/', /^https:\/\/api\./u], exclude: [{ regex: 'health$' }] });
    expect(shouldTrack(req('http://app.test/api/orders'), m)).toBe(true);
    expect(shouldTrack(req('https://api.app.test/orders'), m)).toBe(true);
    expect(shouldTrack(req('http://app.test/web/orders'), m)).toBe(false);
    expect(shouldTrack(req('http://app.test/api/health'), m)).toBe(false);
    // Text patterns are case-sensitive substrings of the raw URL.
    expect(shouldTrack(req('http://app.test/API/orders'), m)).toBe(false);
    // Default exclude: socket.io over XHR.
    expect(shouldTrack(req('http://app.test/socket.io/?EIO=4'), perfDefaults.measure)).toBe(false);
    const thirdParty = req('https://o1.ingest.sentry.io/api/1/envelope/');
    expect(shouldTrack(thirdParty, perfDefaults.measure)).toBe(false);
    expect(shouldTrack(thirdParty, measure({ excludeKnownThirdParty: false }))).toBe(true);
  });

  test('an empty ignoreExtensions list keeps static paths', () => {
    expect(shouldTrack(req('http://app.test/app.js'), measure({ ignoreExtensions: [] }))).toBe(
      true,
    );
  });
});

describe('known third-party hosts', () => {
  test('match the host or a subdomain, never a suffix of another name', () => {
    expect(isKnownThirdPartyHost('google-analytics.com')).toBe(true);
    expect(isKnownThirdPartyHost('www.google-analytics.com')).toBe(true);
    expect(isKnownThirdPartyHost('WWW.Google-Analytics.COM')).toBe(true);
    expect(isKnownThirdPartyHost('notgoogle-analytics.com')).toBe(false);
    expect(isKnownThirdPartyHost('google-analytics.com.evil.test')).toBe(false);
    expect(isKnownThirdPartyHost('example.com')).toBe(false);
  });

  test('the documented list (05, chapter 5.3) is frozen and sorted', () => {
    expect(KNOWN_THIRD_PARTY_HOSTS).toHaveLength(30);
    expect(Object.isFrozen(KNOWN_THIRD_PARTY_HOSTS)).toBe(true);
    expect([...KNOWN_THIRD_PARTY_HOSTS].sort()).toEqual(KNOWN_THIRD_PARTY_HOSTS);
    for (const host of KNOWN_THIRD_PARTY_HOSTS) expect(isKnownThirdPartyHost(host)).toBe(true);
  });

  test('url patterns: substring or regular expression', () => {
    expect(matchesUrlPattern('http://a.test/x', '/x')).toBe(true);
    expect(matchesUrlPattern('http://a.test/x', '/X')).toBe(false);
    expect(matchesUrlPattern('http://a.test/X', /\/x$/iu)).toBe(true);
  });
});
