// Validators for the file formats: schemas/samples, run-report, thresholds and outcome. Each
// mirrors its JSON Schema (01-REQ-36); `schemaVersion` is handled by parse.ts before these run.
import {
  anyObject,
  arr,
  bool,
  constant,
  enumOf,
  int,
  nul,
  nullable,
  num,
  obj,
  oneOf,
  record,
  str,
} from './dsl.ts';
import type { Schema, Sink } from './dsl.ts';
import {
  count,
  envLabelOrNull,
  epochMs,
  evaluationStatus,
  fingerprint,
  hostFingerprint,
  isoDate,
  issue,
  key,
  kind,
  mode,
  ms,
  msLimit,
  msOrNull,
  percentileName,
  ratio,
  runId,
  testsStatus,
  timestamp,
  tool,
} from './common.ts';
import { derivationSettings, packageConfig } from './config.ts';

const nonEmpty = str({ minLength: 1 });
const nonEmptyOrNull = nullable(nonEmpty);

/** Checks `schema` on each listed property that is present (JSON Schema `properties`). */
function present(
  value: Record<string, unknown>,
  pointer: string,
  sink: Sink,
  properties: Record<string, Schema>,
): void {
  for (const [name, schema] of Object.entries(properties)) {
    if (Object.hasOwn(value, name)) schema.check(value[name], `${pointer}/${name}`, sink);
  }
}

// ---- samples.schema.json --------------------------------------------------------------------

const noTiming = {
  duration: nul,
  requestStart: nul,
  ttfb: nul,
  timeSource: constant('browser'),
  fromServiceWorker: constant(false),
};

const requestSample = obj(
  {
    method: str({ pattern: /^[A-Z]+$/u }),
    url: nonEmpty,
    resourceType: nonEmpty,
    status: oneOf(int({ minimum: 100, maximum: 599 }), constant('FAILED'), constant('PENDING')),
    failureText: nonEmpty,
    startTime: epochMs,
    duration: msOrNull,
    requestStart: msOrNull,
    ttfb: msOrNull,
    timeSource: enumOf(['browser', 'node']),
    fromServiceWorker: bool,
  },
  {
    required: [
      'method',
      'url',
      'resourceType',
      'status',
      'startTime',
      'duration',
      'requestStart',
      'ttfb',
      'timeSource',
      'fromServiceWorker',
    ],
    refine(value, pointer, sink) {
      // A missing status makes the schema's `if` true; the sample is invalid anyway (required).
      const status = Object.hasOwn(value, 'status') ? value.status : 'FAILED';
      if (status === 'FAILED' && !Object.hasOwn(value, 'failureText')) {
        sink.add(pointer, "must have required property 'failureText' when status is FAILED");
      }
      if (status !== 'FAILED' && Object.hasOwn(value, 'failureText')) {
        sink.add(`${pointer}/failureText`, 'must NOT be present unless status is FAILED');
      }
      if (status === 'FAILED' || status === 'PENDING' || !Object.hasOwn(value, 'status')) {
        present(value, pointer, sink, noTiming);
      }
    },
  },
);

export const sampleBatch = obj(
  {
    schemaVersion: constant(2),
    collector: obj(
      {
        name: str({ pattern: /^[a-z0-9-]+$/u }),
        version: nonEmpty,
        browserName: nonEmptyOrNull,
      },
      { required: ['name', 'version', 'browserName'] },
    ),
    requests: arr(requestSample),
    diagnostics: arr(issue),
  },
  { required: ['schemaVersion', 'collector', 'requests', 'diagnostics'] },
);

// ---- thresholds.schema.json -----------------------------------------------------------------

const LIMIT_FIELDS = ['t', 'median', 'percentile', 'p99', 'minApdex', 'maxWilson', 'maxErrorRate'];

const thresholdsEntry = obj(
  {
    t: nullable(msLimit),
    median: msLimit,
    percentile: msLimit,
    p99: msLimit,
    minApdex: nullable(ratio),
    maxWilson: nullable(ratio),
    maxErrorRate: ratio,
    locked: constant(true),
    note: str({ minLength: 1, maxLength: 500 }),
    gate: constant('warn'),
    until: isoDate,
  },
  {
    refine(value, pointer, sink) {
      if (![...LIMIT_FIELDS, 'gate'].some((name) => Object.hasOwn(value, name))) {
        sink.add(pointer, 'must have at least one limit or gate');
      }
      if (Object.hasOwn(value, 'gate')) {
        for (const name of ['note', 'until']) {
          if (!Object.hasOwn(value, name)) {
            sink.add(pointer, `must have property '${name}' when property 'gate' is present`);
          }
        }
      }
      if (Object.hasOwn(value, 'until') && !Object.hasOwn(value, 'gate')) {
        sink.add(pointer, "must have property 'gate' when property 'until' is present");
      }
    },
  },
);

const thresholdsGenerated = obj(
  {
    tool,
    env: envLabelOrNull,
    sourceRunId: runId,
    sourceRunStartedAt: timestamp,
    sourceSampleCount: count,
    evaluatedPercentile: percentileName,
    derivation: derivationSettings,
    browsers: arr(nonEmpty, { uniqueItems: true }),
    playwrightVersion: nonEmpty,
    host: hostFingerprint,
    normalization: fingerprint,
  },
  {
    required: [
      'tool',
      'env',
      'sourceRunId',
      'sourceRunStartedAt',
      'sourceSampleCount',
      'evaluatedPercentile',
      'derivation',
      'browsers',
      'playwrightVersion',
      'host',
      'normalization',
    ],
  },
);

export const thresholdsFile = obj(
  {
    schemaVersion: constant(2),
    kind,
    generated: oneOf(thresholdsGenerated, nul),
    entries: record(key, thresholdsEntry),
  },
  { required: ['schemaVersion', 'kind', 'generated', 'entries'] },
);

// ---- run-report.schema.json -----------------------------------------------------------------

const evaluationCounts = obj(
  Object.fromEntries(
    [
      'keys',
      'fromFile',
      'fromDefaults',
      'notEvaluated',
      'tooFewSamples',
      'fileEntriesNotEvaluated',
      'medianOnly',
      'unseenThresholdEntries',
      'violations',
      'blockingViolations',
      'muted',
    ].map((name) => [name, count]),
  ),
  {
    required: [
      'keys',
      'fromFile',
      'fromDefaults',
      'notEvaluated',
      'tooFewSamples',
      'fileEntriesNotEvaluated',
      'medianOnly',
      'unseenThresholdEntries',
      'violations',
      'blockingViolations',
      'muted',
    ],
  },
);

const thresholdFileInfo = obj(
  {
    kind,
    path: nonEmpty,
    status: enumOf(['loaded', 'missing', 'invalid']),
    generated: oneOf(anyObject, nul),
    unseenKeys: arr(key),
  },
  { required: ['kind', 'path', 'status', 'generated', 'unseenKeys'] },
);

const testRef = obj(
  {
    title: str(),
    project: str(),
    file: str(),
    line: int({ minimum: 1 }),
    repeatEachIndex: int({ minimum: 0 }),
  },
  { required: ['title', 'project', 'file', 'line', 'repeatEachIndex'] },
);

const slowSample = obj(
  { duration: ms, startedAt: timestamp, test: testRef, url: nonEmpty },
  { required: ['duration', 'startedAt', 'test'] },
);

const stats = obj(
  {
    min: ms,
    avg: ms,
    max: ms,
    percentiles: record(percentileName, ms, { required: ['p50', 'p90', 'p95', 'p99'] }),
  },
  { required: ['min', 'avg', 'max', 'percentiles'] },
);

const check = obj(
  {
    rule: enumOf(['median', 'percentile', 'p99', 'apdex', 'wilson', 'errors']),
    n: int({ minimum: 1 }),
    actual: num({ minimum: 0 }),
    observed: oneOf(num({ minimum: 0, maximum: 1 }), nul),
    limit: num({ minimum: 0 }),
    passed: bool,
    hardLimitExceeded: bool,
    blocking: bool,
    usage: nullable(num({ minimum: 0 })),
  },
  {
    required: [
      'rule',
      'n',
      'actual',
      'observed',
      'limit',
      'passed',
      'hardLimitExceeded',
      'blocking',
      'usage',
    ],
  },
);

const keyEvaluation = obj(
  {
    result: enumOf(['pass', 'fail', 'not-evaluated']),
    reason: oneOf(enumOf(['too-few-samples', 'no-rules', 'thresholds-error']), nul),
    thresholdSource: enumOf(['file', 'default']),
    limits: obj(
      {
        t: nullable(msLimit),
        median: msLimit,
        percentile: msLimit,
        p99: msLimit,
        minApdex: nullable(ratio),
        maxWilson: nullable(ratio),
        maxErrorRate: ratio,
      },
      { required: LIMIT_FIELDS },
    ),
    checks: arr(check),
    muted: oneOf(
      obj(
        { until: isoDate, note: nonEmpty, expired: bool },
        { required: ['until', 'note', 'expired'] },
      ),
      nul,
    ),
  },
  { required: ['result', 'reason', 'thresholdSource', 'limits', 'checks', 'muted'] },
);

/** Hint codes of 11-REQ-34, in rule priority order. */
export const HINT_CODES = [
  'HINT_HARD_LIMIT',
  'HINT_SLOWDOWN',
  'HINT_TAIL',
  'HINT_SHIFT',
  'HINT_OUTLIERS',
  'HINT_ERRORS_DOMINANT',
  'HINT_ERRORS_MIXED',
  'HINT_APDEX',
  'HINT_SLOW_SHARE',
  'HINT_MEDIAN_ONLY',
  'HINT_MUTED',
  'HINT_FAILED_TESTS',
  'HINT_NEAR_LIMIT',
] as const;

const HINT_PARAMS = [
  'rule',
  'usage',
  'medianUsage',
  'factor',
  'max',
  'rate',
  'limit',
  'label',
  'count',
  'errors',
  'label1',
  'count1',
  'label2',
  'count2',
  'label3',
  'count3',
  'apdex',
  'share',
  't',
  'n',
];

const hint = obj(
  { code: enumOf(HINT_CODES), params: record(enumOf(HINT_PARAMS), oneOf(str(), num())) },
  { required: ['code', 'params'] },
);

const histogram = oneOf(
  obj(
    {
      edges: arr(num({ minimum: 0 }), { minItems: 2, maxItems: 31 }),
      counts: arr(count, { minItems: 1, maxItems: 30 }),
    },
    { required: ['edges', 'counts'] },
  ),
  nul,
);

const testCost = obj(
  {
    title: str(),
    project: str(),
    file: str(),
    line: int({ minimum: 1 }),
    executions: int({ minimum: 1 }),
    requestCount: int({ minimum: 1 }),
    errorCount: count,
    totalMs: ms,
    maxRequestMs: msOrNull,
    keyCount: int({ minimum: 1 }),
    topKeys: arr(
      obj(
        { key, count: int({ minimum: 1 }), totalMs: ms },
        { required: ['key', 'count', 'totalMs'] },
      ),
      { maxItems: 3 },
    ),
    violatedKeys: arr(key, { maxItems: 10 }),
    violatedKeyCount: count,
  },
  {
    required: [
      'title',
      'project',
      'file',
      'line',
      'executions',
      'requestCount',
      'errorCount',
      'totalMs',
      'maxRequestMs',
      'keyCount',
      'topKeys',
      'violatedKeys',
      'violatedKeyCount',
    ],
  },
);

const waterfallRequest = obj(
  {
    offset: int({ minimum: 0 }),
    duration: msOrNull,
    key,
    status: str({ pattern: /^(?:[1-5][0-9]{2}|FAILED|ABORTED|PENDING)$/u }),
  },
  { required: ['offset', 'duration', 'key', 'status'] },
);

const waterfall = obj(
  {
    test: testRef,
    totalMs: ms,
    requestCount: int({ minimum: 1 }),
    spanMs: ms,
    requests: arr(waterfallRequest, { maxItems: 200 }),
    omitted: count,
  },
  { required: ['test', 'totalMs', 'requestCount', 'spanMs', 'requests', 'omitted'] },
);

const testBreakdown = oneOf(
  obj(
    {
      tests: arr(testCost, { maxItems: 500 }),
      omitted: count,
      waterfalls: arr(waterfall, { maxItems: 5 }),
    },
    { required: ['tests', 'omitted', 'waterfalls'] },
  ),
  nul,
);

const aggregateProps = {
    count,
    successCount: count,
    errorCount: count,
    fromFailedTests: count,
    testCount: count,
    statuses: record(
      str({ pattern: /^(?:[1-5][0-9]{2}|FAILED|ABORTED|PENDING|ok|error|unfinished)$/u }),
      int({ minimum: 1 }),
    ),
    timeSources: obj({ browser: count, node: count }, { required: ['browser', 'node'] }),
    stats: oneOf(stats, nul),
    ttfb: oneOf(
      obj({ p50: ms, p95: ms, otherP50: msOrNull }, { required: ['p50', 'p95', 'otherP50'] }),
      nul,
    ),
    slowest: arr(slowSample, { maxItems: 3 }),
    topTests: arr(
      obj(
        {
          title: str(),
          project: str(),
          file: str(),
          line: int({ minimum: 1 }),
          sampleCount: int({ minimum: 1 }),
        },
        { required: ['title', 'project', 'file', 'line', 'sampleCount'] },
      ),
      { maxItems: 5 },
    ),
    samples: obj({ durations: arr(ms), sampled: bool }, { required: ['durations', 'sampled'] }),
    evaluation: keyEvaluation,
    histogram,
    hints: arr(hint, { maxItems: 3 }),
};
const aggregateRequired = [
      'count',
      'successCount',
      'errorCount',
      'fromFailedTests',
      'testCount',
      'statuses',
      'timeSources',
      'stats',
      'ttfb',
      'slowest',
      'topTests',
      'samples',
      'evaluation',
      'histogram',
      'hints',
];

const aggregate = obj(aggregateProps, { required: aggregateRequired });

/** Step aggregate (06-REQ-28): the aggregate fields plus location and stepErrorsFromFailedTests. */
const stepAggregate = obj(
  {
    ...aggregateProps,
    location: oneOf(
      obj({ file: nonEmpty, line: int({ minimum: 1 }) }, { required: ['file', 'line'] }),
      nul,
    ),
    stepErrorsFromFailedTests: count,
  },
  { required: [...aggregateRequired, 'location', 'stepErrorsFromFailedTests'] },
);

export const runReport = obj(
  {
    schemaVersion: constant(3),
    tool,
    runId,
    mode,
    startedAt: timestamp,
    finishedAt: timestamp,
    env: envLabelOrNull,
    configDir: nonEmpty,
    config: packageConfig,
    normalization: fingerprint,
    stepNormalization: oneOf(fingerprint, nul),
    ci: oneOf(
      obj(
        {
          provider: enumOf(['github', 'gitlab', 'jenkins', 'azure', 'other']),
          commit: nonEmptyOrNull,
          branch: nonEmptyOrNull,
          buildUrl: nonEmptyOrNull,
        },
        { required: ['provider', 'commit', 'branch', 'buildUrl'] },
      ),
      nul,
    ),
    host: obj(
      {
        platform: str(),
        arch: str(),
        nodeVersion: str(),
        ci: bool,
        cpuCount: int({ minimum: 1 }),
        cpuModel: str(),
      },
      { required: ['platform', 'arch', 'nodeVersion', 'ci', 'cpuCount', 'cpuModel'] },
    ),
    playwright: obj({ version: str() }, { required: ['version'] }),
    runConditions: obj(
      {
        workers: int({ minimum: 1 }),
        projects: arr(
          obj(
            {
              name: str(),
              role: enumOf(['measured', 'dependency', 'teardown']),
              browserName: oneOf(str(), nul),
              repeatEach: int({ minimum: 1 }),
              retries: int({ minimum: 0 }),
            },
            { required: ['name', 'role', 'browserName', 'repeatEach', 'retries'] },
          ),
        ),
        overriddenSettings: arr(str()),
      },
      { required: ['workers', 'projects', 'overriddenSettings'] },
    ),
    tests: obj(
      {
        status: testsStatus,
        expected: count,
        unexpected: count,
        flaky: count,
        skipped: count,
      },
      { required: ['status', 'expected', 'unexpected', 'flaky', 'skipped'] },
    ),
    evaluation: obj(
      {
        status: evaluationStatus,
        gateEnabled: bool,
        counts: obj(
          { api: evaluationCounts, step: evaluationCounts },
          { required: ['api', 'step'] },
        ),
      },
      { required: ['status', 'gateEnabled', 'counts'] },
    ),
    thresholdFiles: arr(thresholdFileInfo),
    warnings: arr(issue),
    toolErrors: arr(issue),
    origins: arr(
      obj(
        { origin: nonEmpty, label: str(), requestCount: count },
        { required: ['origin', 'label', 'requestCount'] },
      ),
    ),
    endpoints: record(key, aggregate),
    steps: record(key, stepAggregate),
    testBreakdown,
  },
  {
    required: [
      'schemaVersion',
      'tool',
      'runId',
      'mode',
      'startedAt',
      'finishedAt',
      'env',
      'configDir',
      'config',
      'normalization',
      'stepNormalization',
      'ci',
      'host',
      'playwright',
      'runConditions',
      'tests',
      'evaluation',
      'thresholdFiles',
      'warnings',
      'toolErrors',
      'origins',
      'endpoints',
      'steps',
      'testBreakdown',
    ],
  },
);

// ---- outcome.schema.json --------------------------------------------------------------------

export const outcomeFile = obj(
  {
    schemaVersion: constant(1),
    runId,
    mode,
    exitCode: enumOf([0, 2, 3]),
    tests: obj({ status: testsStatus }, { required: ['status'] }),
    evaluation: obj(
      { status: evaluationStatus, gateEnabled: bool },
      { required: ['status', 'gateEnabled'] },
    ),
    toolErrors: arr(issue),
    paths: obj(
      {
        reportJson: nonEmptyOrNull,
        reportHtml: nonEmptyOrNull,
        thresholds: arr(nonEmpty),
        thresholdsDiff: nonEmptyOrNull,
      },
      { required: ['reportJson', 'reportHtml', 'thresholds', 'thresholdsDiff'] },
    ),
  },
  {
    required: [
      'schemaVersion',
      'runId',
      'mode',
      'exitCode',
      'tests',
      'evaluation',
      'toolErrors',
      'paths',
    ],
  },
);
