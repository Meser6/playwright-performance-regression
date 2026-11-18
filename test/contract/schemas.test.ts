import { describe, expect, test } from 'vitest';
import { createAjv, ID_PREFIX, readSchema, SCHEMA_FILES, validator } from './schemas.ts';

// Contract tests for the JSON Schemas in schemas/ (01-REQ-36, 02-REQ-01). These tests pin the
// schemas themselves; formats.test.ts compares them with the hand-written validators in
// src/core/schema on the golden files in test/golden/.

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function defaultConfig(): { [key: string]: Json } {
  const config = {};
  validator(createAjv({ useDefaults: true }), 'config.schema.json')(config);
  return config;
}

const tool = { name: 'playwright-performance-regression', version: '0.1.0' };
const host = { platform: 'linux', arch: 'x64', ci: true, cpuCount: 4, cpuModel: 'Test CPU' };

const requestSample = {
  method: 'GET',
  url: 'https://app.example.com/api/tickets/42',
  resourceType: 'fetch',
  status: 200,
  startTime: 1_763_460_000_000,
  duration: 123.4,
  requestStart: 1.2,
  ttfb: 100.5,
  timeSource: 'browser',
  fromServiceWorker: false,
};
const failedRequest = {
  ...requestSample,
  status: 'FAILED',
  failureText: 'net::ERR_CONNECTION_REFUSED',
  duration: null,
  requestStart: null,
  ttfb: null,
};
const samples = {
  schemaVersion: 1,
  collector: { name: 'playwright', version: '0.1.0', browserName: 'chromium' },
  requests: [requestSample, failedRequest],
  custom: [
    { name: 'open ticket', outcome: 'ok', duration: 812.3, endTime: 1_763_460_001_000 },
    { name: 'save ticket', outcome: 'unfinished', duration: null, endTime: null },
  ],
  diagnostics: [],
};

const derivation = {
  t: { min: 500, max: 2000, medianFactor: 2 },
  smallSampleN: 50,
  margins: {
    median: { relative: 0.4, minMs: 100, smallSampleRelative: 0.8 },
    percentile: { relative: 0.4, minMs: 100, smallSampleRelative: 0.8 },
    p99: { relative: 0.2, minGapMs: 50, minGapRelative: 0.1 },
    apdex: { absolute: 0.05, smallSampleAbsolute: 0.1 },
    wilson: { factor: 1.5, add: 0.02, min: 0.03, max: 0.15, smallSampleMin: 0.1 },
    errors: { factor: 2, add: 0.01 },
  },
};
const thresholds = {
  schemaVersion: 1,
  kind: 'api',
  generated: null,
  entries: {
    'GET /api/tickets/:id': {
      t: 500,
      median: 300,
      percentile: 900,
      p99: 1500,
      minApdex: 0.9,
      maxWilson: 0.05,
      maxErrorRate: 0.01,
    },
  },
};

const counts = {
  keys: 0,
  fromFile: 0,
  fromDefaults: 0,
  notEvaluated: 0,
  tooFewSamples: 0,
  fileEntriesNotEvaluated: 0,
  medianOnly: 0,
  unseenThresholdEntries: 0,
  violations: 0,
  blockingViolations: 0,
  muted: 0,
};
function runReport(): { [key: string]: Json } {
  return {
    schemaVersion: 1,
    tool,
    runId: 'run-1',
    mode: 'test',
    startedAt: '2026-11-18T10:00:00.000Z',
    finishedAt: '2026-11-18T10:05:00.000Z',
    env: null,
    configDir: '/home/user/project',
    config: defaultConfig(),
    normalization: '0123456789abcd',
    ci: null,
    host: { ...host, nodeVersion: '22.18.0' },
    playwright: { version: '1.57.0' },
    runConditions: {
      workers: 1,
      projects: [
        { name: 'chromium', role: 'measured', browserName: 'chromium', repeatEach: 5, retries: 0 },
      ],
      overriddenSettings: [],
    },
    tests: { status: 'passed', expected: 3, unexpected: 0, flaky: 0, skipped: 0 },
    evaluation: { status: 'passed', gateEnabled: true, counts: { api: counts, custom: counts } },
    thresholdFiles: [],
    warnings: [],
    toolErrors: [],
    origins: [],
    endpoints: {},
    custom: {},
  };
}

const outcome = {
  schemaVersion: 1,
  runId: 'run-1',
  mode: 'test',
  exitCode: 0,
  tests: { status: 'passed' },
  evaluation: { status: 'passed', gateEnabled: true },
  toolErrors: [],
  paths: {
    reportJson: '/home/user/project/perf-results/report.json',
    reportHtml: null,
    thresholds: [],
    thresholdsDiff: null,
  },
};

describe('schemas', () => {
  test('every schema compiles with Ajv 2020-12 in strict mode', () => {
    const ajv = createAjv();
    expect(SCHEMA_FILES).toEqual([
      'common.schema.json',
      'config.schema.json',
      'outcome.schema.json',
      'run-report.schema.json',
      'samples.schema.json',
      'thresholds.schema.json',
    ]);
    for (const file of SCHEMA_FILES) {
      const schema = readSchema(file);
      expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(schema.$id).toBe(`${ID_PREFIX}${file}`);
      expect(() => ajv.compile({ $ref: `${ID_PREFIX}${file}` })).not.toThrow();
    }
  });

  test('an empty config is valid and Ajv defaults give a valid, complete config', () => {
    const validate = validator(createAjv(), 'config.schema.json');
    expect(validate({})).toBe(true);

    const config = defaultConfig();
    expect(Object.keys(config).sort()).toEqual(
      ['advanced', 'checks', 'gate', 'keys', 'measure', 'report', 'run', 'thresholds'].sort(),
    );
    expect(validate(config), JSON.stringify(validate.errors)).toBe(true);
  });

  test('config rejects unknown and mistyped options', () => {
    const validate = validator(createAjv(), 'config.schema.json');
    expect(validate({ unknownOption: true })).toBe(false);
    expect(validate({ run: { repeat: { test: 'five' } } })).toBe(false);
    expect(validate({ checks: { time: { percentile: { level: 'p100' } } } })).toBe(false);
  });

  test('sample batch: valid batch passes, inconsistent samples are rejected', () => {
    const validate = validator(createAjv(), 'samples.schema.json');
    expect(validate(samples), JSON.stringify(validate.errors)).toBe(true);

    const { failureText: _failureText, ...failedWithoutText } = failedRequest;
    expect(validate({ ...samples, requests: [failedWithoutText] })).toBe(false);

    const okWithFailureText = { ...requestSample, failureText: 'boom' };
    expect(validate({ ...samples, requests: [okWithFailureText] })).toBe(false);
    expect(validate({ ...samples, requests: [{ ...requestSample, method: 'get' }] })).toBe(false);

    const unfinishedWithDuration = {
      name: 'x',
      outcome: 'unfinished',
      duration: 10,
      endTime: null,
    };
    expect(validate({ ...samples, custom: [unfinishedWithDuration] })).toBe(false);

    expect(validate({ ...samples, schemaVersion: 2 })).toBe(false);
  });

  test('run report: valid report passes, broken reports are rejected', () => {
    const validate = validator(createAjv(), 'run-report.schema.json');
    const report = runReport();
    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);

    expect(validate({ ...report, startedAt: '2026-11-18T10:00:00Z' })).toBe(false);
    expect(validate({ ...report, normalization: 'not-a-fingerprint' })).toBe(false);
    expect(validate({ ...report, extra: 1 })).toBe(false);
    const { endpoints: _endpoints, ...withoutEndpoints } = report;
    expect(validate(withoutEndpoints)).toBe(false);
  });

  test('thresholds file: valid files pass, broken files are rejected', () => {
    const validate = validator(createAjv(), 'thresholds.schema.json');
    expect(validate(thresholds), JSON.stringify(validate.errors)).toBe(true);

    const generated = {
      ...thresholds,
      generated: {
        tool,
        env: 'staging',
        sourceRunId: 'run-1',
        sourceRunStartedAt: '2026-11-18T10:00:00.000Z',
        sourceSampleCount: 120,
        evaluatedPercentile: 'p95',
        derivation,
        browsers: ['chromium'],
        playwrightVersion: '1.57.0',
        host,
        normalization: '0123456789abcd',
      },
    };
    expect(validate(generated), JSON.stringify(validate.errors)).toBe(true);

    expect(validate({ ...thresholds, kind: 'web' })).toBe(false);
    expect(validate({ ...thresholds, entries: { 'GET /a': {} } })).toBe(false);
    expect(validate({ ...thresholds, entries: { 'GET /a': { median: 10.5 } } })).toBe(false);
    expect(validate({ ...thresholds, entries: { 'GET /a': { maxErrorRate: 1.5 } } })).toBe(false);
  });

  describe('02-AC-12 thresholds entry muting', () => {
    const validate = validator(createAjv(), 'thresholds.schema.json');
    const withEntry = (entry: { [key: string]: Json }) => ({
      ...thresholds,
      entries: { 'GET /api/tickets': entry },
    });
    const mute = { gate: 'warn', note: 'Known slow, JIRA-1', until: '2026-12-31' };

    test('02-AC-12 accepts an entry with only muting and no limits', () => {
      expect(validate(withEntry(mute)), JSON.stringify(validate.errors)).toBe(true);
      expect(validate(withEntry({ ...mute, percentile: 900 }))).toBe(true);
    });

    test('02-AC-12 rejects until without gate', () => {
      expect(validate(withEntry({ percentile: 900, note: 'n', until: '2026-12-31' }))).toBe(false);
    });

    test('02-AC-12 rejects gate without note', () => {
      expect(validate(withEntry({ gate: 'warn', until: '2026-12-31' }))).toBe(false);
    });

    test('02-AC-12 rejects gate without until', () => {
      expect(validate(withEntry({ gate: 'warn', note: 'n' }))).toBe(false);
    });

    test('02-AC-12 rejects a gate other than warn', () => {
      expect(validate(withEntry({ ...mute, gate: 'off' }))).toBe(false);
    });

    test('02-AC-12 rejects an invalid date', () => {
      for (const until of [
        '2026-13-01',
        '2026-12-32',
        '2026/12/31',
        '31-12-2026',
        '2026-12-31T00:00',
      ]) {
        expect(validate(withEntry({ ...mute, until })), until).toBe(false);
      }
    });
  });

  test('outcome file: valid outcome passes, broken outcomes are rejected', () => {
    const validate = validator(createAjv(), 'outcome.schema.json');
    expect(validate(outcome), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...outcome, exitCode: 1 })).toBe(false);
    expect(validate({ ...outcome, mode: 'report' })).toBe(false);
    expect(validate({ ...outcome, paths: { ...outcome.paths, reportHtml: '' } })).toBe(false);
  });
});
