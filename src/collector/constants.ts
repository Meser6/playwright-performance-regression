// Documented constants of the collector (05, P-13).

/**
 * Hosts of analytics, tag manager, monitoring and chat services skipped while
 * measure.excludeKnownThirdParty is on (05, chapter 5.3). Changing the list changes measurement
 * results, so every change is a minor release with a CHANGELOG entry (05-REQ-09).
 */
export const KNOWN_THIRD_PARTY_HOSTS: readonly string[] = Object.freeze([
  'amplitude.com',
  'analytics.google.com',
  'browser-intake-datadoghq.com',
  'bugsnag.com',
  'clarity.ms',
  'cookiebot.com',
  'cookielaw.org',
  'datadoghq.com',
  'datadoghq.eu',
  'doubleclick.net',
  'facebook.net',
  'fullstory.com',
  'google-analytics.com',
  'googlesyndication.com',
  'googletagmanager.com',
  'hotjar.com',
  'hotjar.io',
  'intercom.io',
  'intercomcdn.com',
  'launchdarkly.com',
  'logrocket.com',
  'lr-ingest.io',
  'mixpanel.com',
  'newrelic.com',
  'nr-data.net',
  'onetrust.com',
  'optimizely.com',
  'segment.com',
  'segment.io',
  'sentry.io',
]);

/**
 * Time kept free at the end of the teardown slot for user fixture teardowns run before and
 * after the collector's wait (05-REQ-27).
 */
export const PENDING_RESERVE_MS = 1000;

/** Request samples kept per test; the rest are counted in a diagnostic (05-REQ-16). */
export const SAMPLE_LIMIT_PER_TEST = 20_000;

/** collector.name in the sample batch (05-REQ-15). */
export const COLLECTOR_NAME = 'playwright-js';

/** Request body characters read for operation names; the rest is cut off (18-REQ-07, P-13). */
export const OPERATION_BODY_LIMIT = 65_536;
