// Validator for schemas/config.schema.json: the effective config snapshot in the run report
// (02-REQ-17) and the derivation settings in thresholds files. Structure only; config resolution
// with CONFIG_* codes is a separate concern (03).
import { arr, bool, constant, enumOf, int, nullable, num, obj, oneOf, record, str } from './dsl.ts';
import type { Schema } from './dsl.ts';
import { envLabelOrNull, msLimit, percentileName, ratio } from './common.ts';

const factor10 = num({ minimum: 0, maximum: 10 });
const unit = num({ minimum: 0, maximum: 1 });

export const urlPattern = oneOf(
  str({ minLength: 1 }),
  obj(
    {
      regex: str({ minLength: 1 }),
      flags: str({ pattern: /^[dgimsuyv]*$/u, format: 'regular expression flags from "dgimsuyv"' }),
    },
    { required: ['regex'] },
  ),
);

const limitByKind = (value: Schema): Schema => obj({ api: value, custom: value });

const relativeMargin = obj({
  relative: factor10,
  minMs: int({ minimum: 0 }),
  smallSampleRelative: factor10,
});
const p99Margin = obj({
  relative: factor10,
  minGapMs: int({ minimum: 1 }),
  minGapRelative: factor10,
});
const apdexMargin = obj({ absolute: unit, smallSampleAbsolute: unit });
const wilsonMargin = obj({
  factor: factor10,
  add: unit,
  min: unit,
  max: unit,
  smallSampleMin: unit,
});
const errorsMargin = obj({ factor: factor10, add: unit, min: unit });
const tSettings = obj({
  min: msLimit,
  max: msLimit,
  medianFactor: num({ minimum: 1, maximum: 10 }),
});

const enabled = bool;
const minSamples = int({ minimum: 1 });

const checks = obj({
  time: obj({
    median: obj({ enabled, minSamples, margin: relativeMargin, limit: limitByKind(msLimit) }),
    percentile: obj({
      enabled,
      minSamples,
      level: percentileName,
      limit: limitByKind(msLimit),
      margin: relativeMargin,
    }),
    p99: obj({ enabled, minSamples, margin: p99Margin, limit: limitByKind(msLimit) }),
  }),
  slowShare: obj({
    t: obj({ api: tSettings, custom: tSettings }),
    apdex: obj({ enabled, minSamples, margin: apdexMargin, limit: limitByKind(ratio) }),
    wilson: obj({ enabled, minSamples, margin: wilsonMargin, limit: limitByKind(ratio) }),
  }),
  errors: obj({
    enabled,
    minSamples,
    statuses: arr(
      str({
        pattern: /^(?:[1-5]xx|[1-5][0-9]{2}|FAILED|ABORTED|PENDING)$/u,
        format: 'a status like "5xx", "429", "FAILED", "ABORTED" or "PENDING"',
      }),
      {
        uniqueItems: true,
      },
    ),
    limit: limitByKind(ratio),
    margin: errorsMargin,
  }),
});

const uniqueStrings = (minLength?: number): Schema =>
  arr(str(minLength === undefined ? {} : { minLength }), { uniqueItems: true });

export const packageConfig = obj({
  $schema: str(),
  run: obj({
    env: envLabelOrNull,
    repeat: obj({
      test: int({ minimum: 1, maximum: 1000 }),
      thresholds: int({ minimum: 1, maximum: 1000 }),
    }),
    projects: oneOf(constant('auto'), arr(str(), { minItems: 1, uniqueItems: true })),
    keepReporters: uniqueStrings(1),
  }),
  measure: obj({
    resourceTypes: arr(
      enumOf([
        'document',
        'stylesheet',
        'image',
        'media',
        'font',
        'script',
        'texttrack',
        'xhr',
        'fetch',
        'eventsource',
        'manifest',
        'other',
      ]),
      { uniqueItems: true, minItems: 1 },
    ),
    ignoreExtensions: arr(
      str({ pattern: /^\.[a-z0-9]+$/u, format: 'a lowercase extension with a dot, like ".js"' }),
      { uniqueItems: true },
    ),
    include: arr(urlPattern),
    exclude: arr(urlPattern),
    excludeKnownThirdParty: bool,
    successStatuses: arr(
      str({
        pattern: /^(?:[1-5]xx|[1-5][0-9]{2})$/u,
        format: 'a status class like "2xx" or a code like "404"',
      }),
      {
        uniqueItems: true,
        minItems: 1,
      },
    ),
    pendingTimeoutMs: int({ minimum: 0, maximum: 60000 }),
  }),
  keys: obj({
    origins: record(
      str({
        pattern: /^https?:\/\/[^/?#]+$/u,
        format: 'an origin without a path, like "https://api.example.com"',
      }),
      str({
        pattern: /^[a-z0-9.-]*$/u,
        maxLength: 64,
        format: 'a label of lowercase letters, digits, "." and "-", like "api"',
      }),
    ),
    idPatterns: obj({
      number: bool,
      uuid: bool,
      hex: bool,
      token: bool,
      mixed: bool,
      email: bool,
    }),
    extraIdPatterns: arr(urlPattern),
    query: enumOf(['names', 'ignore']),
    keepQueryValues: uniqueStrings(1),
    dropQueryParams: uniqueStrings(1),
    keyBuilder: constant('[function]'),
  }),
  checks,
  gate: obj({
    tolerance: oneOf(
      int({ minimum: 0 }),
      str({
        pattern: /^(?:100|[0-9]{1,2}(?:\.[0-9]+)?)%$/u,
        format: 'an integer >= 0 (ms) or a percentage like "5%"',
      }),
    ),
    hardLimitFactor: nullable(num({ minimum: 1 })),
    defaultThresholds: enumOf(['block', 'warn']),
    warnOnly: bool,
    maxFailedTestShare: unit,
  }),
  thresholds: obj({
    dir: str({ minLength: 1 }),
    filePrefix: str({
      pattern: /^[A-Za-z0-9._-]+$/u,
      format: 'a file name prefix of letters, digits, ".", "_" and "-"',
    }),
    update: enumOf(['all', 'new-only']),
    smallSampleN: int({ minimum: 1 }),
    hysteresis: obj({ relative: unit, ratio: num({ minimum: 0, maximum: 0.01 }) }),
    loosenWarnRelative: num({ minimum: 0, maximum: 100 }),
  }),
  report: obj({ dir: str({ minLength: 1 }), html: bool, rawUrls: bool }),
  advanced: obj({
    maxSamplesPerKey: int({ minimum: 100, maximum: 100000 }),
    seed: int({ minimum: 0, maximum: 4294967295 }),
  }),
});

export const derivationSettings = obj(
  {
    t: obj(
      { min: msLimit, max: msLimit, medianFactor: num({ minimum: 1, maximum: 10 }) },
      { required: ['min', 'max', 'medianFactor'] },
    ),
    smallSampleN: int({ minimum: 1 }),
    margins: obj(
      {
        median: relativeMargin,
        percentile: relativeMargin,
        p99: p99Margin,
        apdex: apdexMargin,
        wilson: wilsonMargin,
        errors: errorsMargin,
      },
      { required: ['median', 'percentile', 'p99', 'apdex', 'wilson', 'errors'] },
    ),
  },
  { required: ['t', 'smallSampleN', 'margins'] },
);
