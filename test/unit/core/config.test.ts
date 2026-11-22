import { describe, expect, expectTypeOf, test } from 'vitest';
import {
  DEFAULT_CONFIG,
  expandSteps,
  definePerfConfig,
  perfDefaults,
  resolveConfig,
} from '../../../src/core/config/index.ts';
import type {
  ConfigOverrides,
  KeyBuilder,
  PerfConfigInput,
  ResolvedConfig,
  ResolvedConfigResult,
  UrlPattern,
} from '../../../src/core/config/index.ts';
import { stringifyStable } from '../../../src/core/format/index.ts';
import type { ConfigIssue } from '../../../src/core/types/index.ts';

function resolved(input: unknown, overrides: ConfigOverrides = {}): ResolvedConfigResult {
  const result = resolveConfig(input as PerfConfigInput, overrides);
  if (!result.ok) throw new Error(`unexpected issues: ${JSON.stringify(result.issues)}`);
  return result.value;
}

function issues(input: unknown, overrides: ConfigOverrides = {}): ConfigIssue[] {
  const result = resolveConfig(input as PerfConfigInput, overrides);
  if (result.ok) throw new Error('expected issues');
  return result.issues;
}

const codes = (list: ConfigIssue[]): string[] => list.map((i) => i.code);

/** The snapshot of an empty config: the schema defaults with measure.steps expanded (03-REQ-18). */
const DEFAULT_SNAPSHOT = {
  ...DEFAULT_CONFIG,
  measure: { ...DEFAULT_CONFIG.measure, steps: expandSteps(true) },
};

describe('defaults and merging (03-REQ-04 – 03-REQ-08)', () => {
  test('03-AC-01 resolveConfig(undefined, {}) equals DEFAULT_CONFIG', () => {
    const { config, snapshot, warnings } = resolved(undefined);
    // measure.steps: the schema default true becomes the full object (03-REQ-18).
    const expected = {
      ...DEFAULT_CONFIG,
      measure: { ...DEFAULT_CONFIG.measure, steps: expandSteps(true) },
    };
    expect(snapshot).toEqual(expected);
    expect(config).toEqual({
      ...expected,
      keys: { ...DEFAULT_CONFIG.keys, keyBuilder: undefined },
    });
    expect(warnings).toEqual([]);
    expect(resolved({}).snapshot).toEqual(expected);
  });

  test('the result shares no objects with DEFAULT_CONFIG or the input', () => {
    const input = { measure: { exclude: ['a'] } };
    const { config, snapshot } = resolved(input);
    config.measure.exclude.push('b');
    snapshot.run.keepReporters.push('junit');
    config.measure.resourceTypes.push('image');
    expect(input.measure.exclude).toEqual(['a']);
    expect(DEFAULT_CONFIG.run.keepReporters).toEqual([]);
    expect(DEFAULT_CONFIG.measure.resourceTypes).toEqual(['document', 'xhr', 'fetch']);
  });

  test('03-AC-05 a user array replaces the default array; objects are merged', () => {
    const { snapshot } = resolved({
      measure: { exclude: ['intercom.io'], resourceTypes: ['fetch'] },
      checks: { time: { percentile: { limit: { api: 2500 } } } },
    });
    expect(snapshot.measure.exclude).toEqual(['intercom.io']);
    expect(snapshot.measure.resourceTypes).toEqual(['fetch']);
    expect(snapshot.checks.time.percentile.limit).toEqual({ api: 2500, step: 15000 });
    expect(snapshot.checks.time.percentile.level).toBe(DEFAULT_CONFIG.checks.time.percentile.level);
    expect(snapshot.measure.include).toEqual(DEFAULT_CONFIG.measure.include);
  });

  test('03-AC-05 null and scalars replace the default; an empty array clears a list', () => {
    const { snapshot } = resolved({ gate: { hardLimitFactor: null }, measure: { exclude: [] } });
    expect(snapshot.gate.hardLimitFactor).toBeNull();
    expect(snapshot.measure.exclude).toEqual([]);
  });

  test('03-AC-05 perfDefaults extends a default list (03-D-02)', () => {
    const { snapshot } = resolved(
      definePerfConfig({ measure: { exclude: [...perfDefaults.measure.exclude, 'intercom.io'] } }),
    );
    expect(snapshot.measure.exclude).toEqual([...DEFAULT_CONFIG.measure.exclude, 'intercom.io']);
  });

  test('properties set to undefined count as not set', () => {
    expect(resolved({ run: { env: undefined }, keys: { keyBuilder: undefined } }).snapshot).toEqual(
      DEFAULT_SNAPSHOT,
    );
  });

  test('$schema of a JSON file is accepted and not part of the effective config', () => {
    const { snapshot } = resolved({ $schema: './node_modules/x/schemas/config.schema.json' });
    expect(snapshot).toEqual(DEFAULT_SNAPSHOT);
  });

  test('03-AC-06 environment overrides win over the config (03-REQ-07)', () => {
    const input = { run: { env: 'staging', passes: { test: 3, thresholds: 7 } } };
    expect(resolved(input, { env: 'prod', passes: 9 }).snapshot.run).toMatchObject({
      env: 'prod',
      passes: { test: 9, thresholds: 7 },
    });
    expect(resolved(input, { passes: 9, mode: 'thresholds' }).snapshot.run.passes).toEqual({
      test: 3,
      thresholds: 9,
    });
    expect(resolved(input, { env: null }).snapshot.run.env).toBeNull();
    expect(resolved(input, {}).snapshot.run).toMatchObject({ env: 'staging' });
  });

  test('invalid overrides are reported with the option they replace', () => {
    const list = issues({}, { env: 'Prod', passes: 0, mode: 'thresholds' });
    expect(list.map((i) => [i.code, i.path])).toEqual([
      ['CONFIG_INVALID_VALUE', 'run.env'],
      ['CONFIG_INVALID_VALUE', 'run.passes.thresholds'],
    ]);
  });

  test('the same input gives a byte-identical snapshot (01-REQ-03)', () => {
    const input = {
      keys: { origins: { 'https://b.example.com': 'b', 'https://a.example.com': 'a' } },
    };
    expect(stringifyStable(resolved(input).snapshot)).toBe(
      stringifyStable(resolved(input).snapshot),
    );
  });
});

describe('URL patterns and the key builder (03, chapter 5; 02-REQ-17)', () => {
  test('RegExp and { regex, flags } compile to RegExp; strings stay substrings', () => {
    const { config, snapshot } = resolved({
      measure: { include: ['/api/', /^https:\/\/x\//i, { regex: '\\.json$' }] },
      keys: { extraIdPatterns: [{ regex: '^[a-z]{3}-\\d+$', flags: 'u' }] },
    });
    expect(config.measure.include[0]).toBe('/api/');
    expect(config.measure.include[1]).toEqual(/^https:\/\/x\//i);
    expect(config.measure.include[2]).toEqual(/\.json$/);
    expect(config.keys.extraIdPatterns[0]).toEqual(/^[a-z]{3}-\d+$/u);
    expect(snapshot.measure.include).toEqual([
      '/api/',
      { regex: '^https:\\/\\/x\\/', flags: 'i' },
      { regex: '\\.json$', flags: '' },
    ]);
    expect(snapshot.keys.extraIdPatterns).toEqual([{ regex: '^[a-z]{3}-\\d+$', flags: 'u' }]);
  });

  test('g and y flags are dropped when compiling; the snapshot keeps them', () => {
    const { config, snapshot } = resolved({
      measure: { exclude: [/socket/gi, { regex: 'poll', flags: 'yu' }] },
      keys: { extraIdPatterns: [{ regex: '^[A-Z]{2}-[0-9]+$', flags: 'g' }] },
    });
    expect(config.measure.exclude.map((p) => (p as RegExp).flags)).toEqual(['i', 'u']);
    expect((config.keys.extraIdPatterns[0] as RegExp).flags).toBe('');
    const pattern = config.keys.extraIdPatterns[0] as RegExp;
    expect([pattern.test('PL-1'), pattern.test('PL-1')]).toEqual([true, true]);
    expect(snapshot.measure.exclude).toEqual([
      { regex: 'socket', flags: 'gi' },
      { regex: 'poll', flags: 'yu' },
    ]);
    expect(snapshot.keys.extraIdPatterns).toEqual([{ regex: '^[A-Z]{2}-[0-9]+$', flags: 'g' }]);
  });

  test('a snapshot resolves to the same snapshot', () => {
    const first = resolved({ measure: { exclude: [/socket/g] } }).snapshot;
    expect(resolved(first, { source: 'snapshot' }).snapshot).toEqual(first);
  });

  test('a keyBuilder function is kept and written as "[function]" in the snapshot', () => {
    const keyBuilder: KeyBuilder = (req) =>
      req.url.includes('/graphql') ? 'POST graphql' : undefined;
    const { config, snapshot } = resolved({ keys: { keyBuilder } });
    expect(config.keys.keyBuilder).toBe(keyBuilder);
    expect(snapshot.keys.keyBuilder).toBe('[function]');
    expect(resolved({}).snapshot.keys).not.toHaveProperty('keyBuilder');
  });

  test('03-AC-11 keys.keyBuilder in a JSON config file is CONFIG_INVALID_TYPE; in a snapshot it is accepted', () => {
    const input = { keys: { keyBuilder: '[function]' } };
    const list = issues(input, { source: 'json' });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ code: 'CONFIG_INVALID_TYPE', path: 'keys.keyBuilder' });
    expect(list[0]?.message).toContain('not allowed in a JSON config file');

    const { config, snapshot } = resolved(input, { source: 'snapshot' });
    expect(snapshot.keys.keyBuilder).toBe('[function]');
    expect(config.keys.keyBuilder).toBeUndefined();
  });

  test('03-AC-03 a keyBuilder that is not a function gives CONFIG_INVALID_TYPE', () => {
    const [problem, ...rest] = issues({ keys: { keyBuilder: '[function]' } });
    expect(rest).toEqual([]);
    expect(problem).toMatchObject({ code: 'CONFIG_INVALID_TYPE', path: 'keys.keyBuilder' });
    expect(problem?.message).toBe('keys.keyBuilder: must be a function, got "[function]"');
    expect(problem?.hint).toContain('function');
    expect(codes(issues({ keys: { keyBuilder: () => 'k' } }, { source: 'snapshot' }))).toEqual([
      'CONFIG_INVALID_TYPE',
    ]);
  });

  test('perfDefaults is the resolved default config, deeply frozen', () => {
    expect(perfDefaults).toEqual(resolved(undefined).config);
    expect(Object.isFrozen(perfDefaults)).toBe(true);
    expect(Object.isFrozen(perfDefaults.measure.exclude)).toBe(true);
    expect(Object.isFrozen(perfDefaults.checks.time.median.limit)).toBe(true);
    expect(() => {
      (perfDefaults.measure.exclude as string[]).push('x');
    }).toThrow(TypeError);
  });

  test('definePerfConfig returns its argument unchanged', () => {
    const config = { run: { passes: { test: 3 } } };
    expect(definePerfConfig(config)).toBe(config);
  });

  test('the input type accepts RegExp, { regex, flags } and a key builder function', () => {
    expectTypeOf<UrlPattern>().toEqualTypeOf<string | RegExp | { regex: string; flags?: string }>();
    expectTypeOf<{
      measure: { include: UrlPattern[] };
      keys: { keyBuilder: KeyBuilder; extraIdPatterns: RegExp[] };
      checks: { time: { p99: { enabled: false } } };
    }>().toExtend<PerfConfigInput>();
    expectTypeOf<{ measure: { exclude: number[] } }>().not.toExtend<PerfConfigInput>();
    expectTypeOf<{ unknownOption: true }>().not.toExtend<PerfConfigInput>();
    expectTypeOf<ResolvedConfig['keys']['keyBuilder']>().toEqualTypeOf<KeyBuilder | undefined>();
    expectTypeOf<ResolvedConfig['measure']['exclude']>().toEqualTypeOf<(string | RegExp)[]>();
  });
});

describe('validation and error catalog (03-REQ-09 – 03-REQ-12)', () => {
  test('03-AC-04 an unknown option with a typo suggests the correct name', () => {
    const [problem] = issues({ measure: { exclud: ['x'] } });
    expect(problem).toMatchObject({ code: 'CONFIG_UNKNOWN_OPTION', path: 'measure.exclud' });
    expect(problem?.message).toBe(
      'measure.exclud: unknown option. Did you mean "measure.exclude"?',
    );
    expect(problem?.hint).toContain('measure.exclude');
  });

  test('03-AC-04 suggestions: nested options, misplaced options and no suggestion beyond distance 2', () => {
    expect(issues({ checks: { time: { percentil: {} } } })[0]?.message).toContain(
      'Did you mean "checks.time.percentile"?',
    );
    expect(issues({ keys: { keybuilder: () => 'k' } })[0]?.message).toContain(
      'Did you mean "keys.keyBuilder"?',
    );
    const pattern = issues({ measure: { include: [{ regexp: 'x' }] } });
    expect(pattern.find((i) => i.code === 'CONFIG_UNKNOWN_OPTION')?.message).toContain(
      'Did you mean "measure.include[0].regex"?',
    );
    expect(issues({ tolerance: 5 })[0]?.message).toContain('Did you mean "gate.tolerance"?');
    const far = issues({ measure: { somethingElse: true } })[0];
    expect(far?.message).toBe('measure.somethingElse: unknown option');
    expect(far?.hint).toContain('schemas/config.schema.json');
  });

  test('03-AC-03 CONFIG_UNKNOWN_OPTION names the option', () => {
    expect(issues({ run: { passs: 3 } })[0]).toMatchObject({
      code: 'CONFIG_UNKNOWN_OPTION',
      path: 'run.passs',
      message: 'run.passs: unknown option. Did you mean "run.passes"?',
    });
  });

  test('03-AC-16 run.passes defaults to 5 and 10; run.repeat is unknown with a hint (03-REQ-23)', () => {
    expect(resolved({}).snapshot.run.passes).toEqual({ test: 5, thresholds: 10 });
    expect(issues({ run: { passes: { test: 0 } } })[0]).toMatchObject({
      code: 'CONFIG_INVALID_VALUE',
      path: 'run.passes.test',
    });
    const [old] = issues({ run: { repeat: { test: 3 } } });
    expect(old).toMatchObject({ code: 'CONFIG_UNKNOWN_OPTION', path: 'run.repeat' });
    expect(old?.hint).toContain('Renamed to run.passes');
  });

  test('03-AC-03 CONFIG_INVALID_TYPE gives the path, the value received and an example', () => {
    const [problem] = issues({ run: { passes: { test: 'five' } } });
    expect(problem).toEqual({
      code: 'CONFIG_INVALID_TYPE',
      path: 'run.passes.test',
      message: 'run.passes.test: must be integer, got "five"',
      hint: 'Default: 5. schemas/config.schema.json in the package lists every option and its format.',
    });
    expect(issues(5)[0]).toMatchObject({ code: 'CONFIG_INVALID_TYPE', path: '' });
    expect(issues({ report: { html: () => true } })[0]?.message).toBe(
      'report.html: must be boolean, got a function',
    );
  });

  test('03-AC-03 CONFIG_INVALID_VALUE gives the expected format with an example', () => {
    const [problem] = issues({ gate: { tolerance: '5' } });
    expect(problem).toMatchObject({ code: 'CONFIG_INVALID_VALUE', path: 'gate.tolerance' });
    expect(problem?.message).toBe(
      'gate.tolerance: must be an integer >= 0 (ms) or a percentage like "5%", got "5"',
    );
    expect(problem?.hint).toContain('Default: 0.');
    expect(issues({ keys: { origins: { 'api.example.com': 'api' } } })[0]).toMatchObject({
      code: 'CONFIG_INVALID_VALUE',
      path: 'keys.origins["api.example.com"]',
    });
  });

  test('03-AC-03 CONFIG_INVALID_REGEX names the pattern and the reason', () => {
    const list = issues({
      measure: { include: [{ regex: '(' }] },
      keys: { extraIdPatterns: ['ok', { regex: 'a', flags: 'uv' }] },
    });
    expect(list.map((i) => [i.code, i.path])).toEqual([
      ['CONFIG_INVALID_REGEX', 'measure.include[0]'],
      ['CONFIG_INVALID_REGEX', 'keys.extraIdPatterns[1]'],
    ]);
    expect(list[0]?.message).toMatch(
      /^measure\.include\[0\]: regular expression does not compile \(/u,
    );
    expect(list[0]?.hint).toContain('RegExp');
  });

  test('03-AC-11 checks.time.percentile.level "p40" gives CONFIG_INVALID_VALUE', () => {
    const [problem, ...rest] = issues({ checks: { time: { percentile: { level: 'p40' } } } });
    expect(rest).toEqual([]);
    expect(problem).toMatchObject({
      code: 'CONFIG_INVALID_VALUE',
      path: 'checks.time.percentile.level',
      message: 'checks.time.percentile.level: must be at least "p50", got "p40"',
    });
    expect(resolved({ checks: { time: { percentile: { level: 'p50' } } } }).warnings).toEqual([]);
  });

  test('03-AC-03 limits must not decrease from median to percentile to p99', () => {
    expect(issues({ checks: { time: { median: { limit: { api: 3000 } } } } })).toEqual([
      {
        code: 'CONFIG_INVALID_VALUE',
        path: 'checks.time.median.limit.api',
        message:
          'checks.time.median.limit.api: must be <= checks.time.percentile.limit.api (2000), got 3000',
        hint: expect.stringContaining('must not decrease') as string,
      },
    ]);
    expect(issues({ checks: { time: { p99: { limit: { api: 1000 } } } } })).toEqual([
      {
        code: 'CONFIG_INVALID_VALUE',
        path: 'checks.time.p99.limit.api',
        message:
          'checks.time.p99.limit.api: must be >= checks.time.percentile.limit.api (2000), got 1000',
        hint: expect.stringContaining('must not decrease') as string,
      },
    ]);
    // The T threshold may be above the percentile limit (10-D-03).
    expect(
      resolved({ checks: { slowShare: { t: { api: { min: 3000, max: 3000 } } } } }).warnings,
    ).toEqual([]);
  });

  test('03-AC-03 T bounds and the Wilson margin need min <= max', () => {
    const list = issues({
      checks: {
        slowShare: {
          t: { api: { min: 2500 } },
          wilson: { margin: { min: 0.2 } },
        },
      },
    });
    expect(list.map((i) => [i.code, i.path])).toEqual([
      ['CONFIG_INVALID_VALUE', 'checks.slowShare.t.api.min'],
      ['CONFIG_INVALID_VALUE', 'checks.slowShare.wilson.margin.min'],
    ]);
    expect(list[0]?.message).toBe(
      'checks.slowShare.t.api.min: must be <= checks.slowShare.t.api.max (2000), got 2500',
    );
  });

  test('03-AC-03 minSamples of every rule is at least the median minSamples', () => {
    const list = issues({ checks: { time: { median: { minSamples: 30 } } } });
    // One issue per rule that needs fewer samples, all about the option the user set.
    expect(list.map((i) => i.message)).toEqual([
      'checks.time.median.minSamples: must be <= checks.time.percentile.minSamples (20), got 30',
      'checks.time.median.minSamples: must be <= checks.slowShare.apdex.minSamples (20), got 30',
      'checks.time.median.minSamples: must be <= checks.slowShare.wilson.minSamples (20), got 30',
      'checks.time.median.minSamples: must be <= checks.errors.minSamples (5), got 30',
    ]);
    expect(issues({ checks: { errors: { minSamples: 2 } } })[0]?.path).toBe(
      'checks.errors.minSamples',
    );
  });

  test('03-AC-03 03-AC-17 at least one rule must be enabled, without an exception', () => {
    const off = { enabled: false };
    const checks = {
      time: { median: off, percentile: off, p99: off },
      slowShare: { apdex: off, wilson: off },
      errors: off,
    };
    expect(issues({ checks })[0]).toMatchObject({
      code: 'CONFIG_INVALID_VALUE',
      path: 'checks',
      hint: 'Enable at least one rule in checks.',
    });
    expect(resolved({ checks: { ...checks, errors: { enabled: true } } }).warnings).toEqual([]);
  });

  test('03-AC-03 warnings: duplicate origin label, eventsource, percentile p99', () => {
    const { warnings } = resolved({
      measure: { resourceTypes: ['fetch', 'eventsource'] },
      keys: {
        origins: {
          'https://a.example.com': 'api',
          'https://b.example.com': 'api',
          'https://c.example.com': 'c',
        },
      },
      checks: { time: { percentile: { level: 'p99' } } },
    });
    expect(warnings.map((w) => [w.code, w.path])).toEqual([
      ['CONFIG_RESOURCE_TYPE_LONG_LIVED', 'measure.resourceTypes'],
      ['CONFIG_DUPLICATE_ORIGIN_LABEL', 'keys.origins'],
      ['CONFIG_PERCENTILE_IS_P99', 'checks.time.percentile.level'],
    ]);
    expect(warnings[1]?.message).toBe(
      'keys.origins: "https://a.example.com", "https://b.example.com" share the label "api", so their endpoint keys are merged',
    );
    for (const warning of warnings) expect(warning.hint).toBeTruthy();
  });

  test('all problems are reported at once, in the order of the input (03-REQ-09)', () => {
    const list = issues({
      report: { html: 'yes' },
      gate: { tolerance: -1 },
      checks: { time: { percentile: { level: 'p10' } } },
      measure: { exclud: [], include: [{ regex: '[' }] },
      run: { passes: { test: 0 } },
    });
    expect(list.map((i) => i.path)).toEqual([
      'report.html',
      'gate.tolerance',
      'checks.time.percentile.level',
      'measure.exclud',
      'measure.include[0]',
      'run.passes.test',
    ]);
  });

  test('an unknown property named __proto__ is reported and does not change prototypes', () => {
    const input = JSON.parse(
      '{"__proto__": {"polluted": true}, "run": {"__proto__": 1}}',
    ) as unknown;
    expect(codes(issues(input))).toEqual(['CONFIG_UNKNOWN_OPTION', 'CONFIG_UNKNOWN_OPTION']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('removed custom measurements (03-REQ-19, D-32)', () => {
  test('03-AC-13 a custom limit or a custom T gives CONFIG_UNKNOWN_OPTION with a hint about measure.steps', () => {
    const inputs = [
      { checks: { time: { median: { limit: { custom: 5000 } } } } },
      { checks: { slowShare: { t: { custom: { min: 500 } } } } },
      { checks: { errors: { limit: { custom: 0.05 } } } },
    ];
    const paths = [
      'checks.time.median.limit.custom',
      'checks.slowShare.t.custom',
      'checks.errors.limit.custom',
    ];
    inputs.forEach((input, i) => {
      const found = issues(input);
      expect(found).toHaveLength(1);
      expect(found[0]).toEqual({
        code: 'CONFIG_UNKNOWN_OPTION',
        path: paths[i],
        message: `${paths[i]}: unknown option`,
        hint: expect.stringContaining('measure.steps'),
      });
      expect(found[0]?.hint).toContain('custom measurements were removed in 0.1.0-next.3');
    });
  });

  test('03-AC-13 perfDefaults and DEFAULT_CONFIG have no custom keys', () => {
    expect(JSON.stringify(perfDefaults)).not.toContain('"custom"');
    expect(JSON.stringify(DEFAULT_CONFIG)).not.toContain('"custom"');
    expect(Object.keys(perfDefaults.checks.time.median.limit)).toEqual(['api', 'step']);
    expect(Object.keys(perfDefaults.checks.slowShare.t)).toEqual(['api', 'step']);
  });

  test('an option named custom outside the checks still gets the usual hint', () => {
    expect(issues({ measure: { custom: true } })[0]).toMatchObject({
      code: 'CONFIG_UNKNOWN_OPTION',
      hint: expect.not.stringContaining('measure.steps'),
    });
  });
});

test('the package entry point exports definePerfConfig and perfDefaults', async () => {
  const entry = await import('../../../src/entries/index.ts');
  expect(Object.keys(entry).sort()).toEqual(['definePerfConfig', 'perfDefaults']);
  expect(entry.perfDefaults).toBe(perfDefaults);
});

describe('step settings (03-REQ-18, 03-REQ-22)', () => {
  test('03-REQ-18 false, true and an object become the full settings', () => {
    expect(resolved({}).snapshot.measure.steps).toEqual({
      enabled: true,
      include: [],
      exclude: [],
      maxDepth: 3,
      categories: ['test.step'],
      groupBy: 'step',
      normalizeTitles: true,
      redactQuotedValues: false,
    });
    expect(resolved({ measure: { steps: false } }).snapshot.measure.steps.enabled).toBe(false);
    const object = resolved({ measure: { steps: { maxDepth: 2, include: [/^login/u] } } });
    expect(object.snapshot.measure.steps).toMatchObject({
      enabled: true,
      maxDepth: 2,
      include: [{ regex: '^login', flags: 'u' }],
    });
    expect(object.config.measure.steps.include[0]).toBeInstanceOf(RegExp);
    expect(
      resolved({ measure: { steps: { enabled: false, maxDepth: 2 } } }).snapshot.measure.steps
        .enabled,
    ).toBe(false);
    expect(perfDefaults.measure.steps.categories).toEqual(['test.step']);
  });

  test('03-AC-13 redactQuotedValues is false by default and keepQuotedValues was renamed', () => {
    expect(resolved({ measure: { steps: {} } }).snapshot.measure.steps.redactQuotedValues).toBe(
      false,
    );
    expect(
      resolved({ measure: { steps: { redactQuotedValues: true } } }).snapshot.measure.steps
        .redactQuotedValues,
    ).toBe(true);
    const [found] = issues({ measure: { steps: { keepQuotedValues: true } } });
    expect(found).toMatchObject({
      code: 'CONFIG_UNKNOWN_OPTION',
      path: 'measure.steps.keepQuotedValues',
    });
    expect(found?.hint).toContain('renamed to redactQuotedValues with the opposite meaning');
  });

  test('03-REQ-18 invalid step settings', () => {
    const codes = (input: unknown) => issues(input).map((i) => [i.code, i.path]);
    expect(codes({ measure: { steps: { maxDepth: 11 } } })).toEqual([
      ['CONFIG_INVALID_VALUE', 'measure.steps.maxDepth'],
    ]);
    expect(codes({ measure: { steps: { categories: [] } } })[0]?.[0]).toBe('CONFIG_INVALID_VALUE');
    expect(codes({ measure: { steps: { categories: ['test.attach'] } } })[0]?.[0]).toBe(
      'CONFIG_INVALID_VALUE',
    );
    expect(codes({ measure: { steps: { exclude: [{ regex: '(' }] } } })).toEqual([
      ['CONFIG_INVALID_REGEX', 'measure.steps.exclude[0]'],
    ]);
    expect(issues({ measure: { steps: { maxDept: 2 } } })[0]?.message).toContain(
      'Did you mean "measure.steps.maxDepth"?',
    );
  });

  test('03-REQ-22 the environment labels steps and requests are reserved', () => {
    for (const label of ['steps', 'requests']) {
      expect(issues({ run: { env: label } })[0]).toMatchObject({
        code: 'CONFIG_INVALID_VALUE',
        path: 'run.env',
      });
      expect(issues({}, { env: label })[0]?.code).toBe('CONFIG_INVALID_VALUE');
    }
    expect(resolved({ run: { env: 'steps-env' } }).snapshot.run.env).toBe('steps-env');
  });
});

describe('removed gate.warnOnly (D-40)', () => {
  test('03-AC-17 gate.warnOnly is CONFIG_UNKNOWN_OPTION with a hint about continue-on-error', () => {
    const [issue] = issues({ gate: { warnOnly: true } });
    expect(issue).toMatchObject({ code: 'CONFIG_UNKNOWN_OPTION', path: 'gate.warnOnly' });
    expect(issue?.hint).toContain('continue-on-error');
    expect(DEFAULT_CONFIG.gate).not.toHaveProperty('warnOnly');
  });
});

describe('margin presets (D-41)', () => {
  test('10-AC-20 a preset sets the margin defaults and explicit fields win', () => {
    const strict = resolved({ thresholds: { preset: 'strict' } }).config.checks;
    expect(strict.time.percentile.margin).toEqual({
      relative: 0.25,
      minMs: 50,
      smallSampleRelative: 0.5,
    });
    expect(strict.time.p99.margin.relative).toBe(0.1);
    expect(strict.errors.margin.factor).toBe(1.25);
    expect(strict.slowShare.apdex.margin).toEqual({ absolute: 0.03, smallSampleAbsolute: 0.06 });
    expect(strict.slowShare.wilson.margin.factor).toBe(1.25);
    // Fields outside the table keep the schema defaults.
    expect(strict.time.p99.margin.minGapMs).toBe(DEFAULT_CONFIG.checks.time.p99.margin.minGapMs);
    expect(strict.errors.margin.add).toBe(DEFAULT_CONFIG.checks.errors.margin.add);

    const loose = resolved({
      thresholds: { preset: 'loose' },
      checks: { time: { median: { margin: { minMs: 30 } } } },
    });
    expect(loose.config.checks.time.median.margin).toEqual({
      relative: 0.6,
      minMs: 30,
      smallSampleRelative: 1.2,
    });
    expect(loose.snapshot.thresholds.preset).toBe('loose');
    expect(loose.config.checks.errors.margin.factor).toBe(2);

    // normal equals the schema defaults.
    expect(resolved({}).config.checks).toEqual(DEFAULT_CONFIG.checks);
    expect(resolved({ thresholds: { preset: 'normal' } }).config.checks).toEqual(
      DEFAULT_CONFIG.checks,
    );
    expect(codes(issues({ thresholds: { preset: 'tight' } }))).toEqual(['CONFIG_INVALID_VALUE']);
  });

  test('10-AC-20 a snapshot with a preset resolves to the same margins (thresholds --from)', () => {
    const first = resolved({ thresholds: { preset: 'strict' } }).snapshot;
    const again = resolved(first, { source: 'snapshot' }).snapshot;
    expect(again).toEqual(first);
  });
});

describe('run.grep (03-REQ-25)', () => {
  test('03-AC-18 run.grep must compile; null by default', () => {
    expect(DEFAULT_CONFIG.run.grep).toBeNull();
    expect(resolved({ run: { grep: '@perf' } }).snapshot.run.grep).toBe('@perf');
    expect(codes(issues({ run: { grep: '(' } }))).toEqual(['CONFIG_INVALID_REGEX']);
    expect(codes(issues({ run: { grep: '' } }))).toEqual(['CONFIG_INVALID_VALUE']);
  });
});

describe('run.overrideSlowMo (03-REQ-27, D-45)', () => {
  test('03-AC-19 run.overrideSlowMo is false by default and must be a boolean', () => {
    expect(DEFAULT_CONFIG.run.overrideSlowMo).toBe(false);
    expect(resolved({ run: { overrideSlowMo: true } }).snapshot.run.overrideSlowMo).toBe(true);
    expect(codes(issues({ run: { overrideSlowMo: 'yes' } }))).toEqual(['CONFIG_INVALID_TYPE']);
  });
});
