// resolveConfig(): defaults from the schema, the user's config, then the environment overrides
// (03, chapter 7). Pure (01-REQ-02): the mode module reads the environment and passes it in.
import type { ConfigIssue, Result } from '../types/common.ts';
import { envLabelOrNull } from '../schema/common.ts';
import { int, isRecord, matches } from '../schema/dsl.ts';
import { DEFAULT_CONFIG } from './generated/defaults.ts';
import { define, describeValue, formatPath, valueAt } from './paths.ts';
import type { Segment } from './paths.ts';
import type {
  ConfigOverrides,
  KeyBuilder,
  PerfConfigInput,
  ResolvedConfig,
  ResolvedConfigJson,
  ResolvedConfigResult,
  ResolvedUrlPattern,
} from './types.ts';
import { expandSteps } from './steps.ts';
import { presetLayer, presetOf } from './presets.ts';
import { issue, PATTERN_LISTS, regexIssues, relationalIssues, schemaIssues } from './validate.ts';

const KEY_BUILDER_SNAPSHOT = '[function]';
const passesSchema = int({ minimum: 1, maximum: 1000 });

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/**
 * JSON form of the input (02-REQ-17): RegExp becomes { regex, flags }, properties set to
 * undefined are left out. Other values are copied as they are, for validation to report.
 */
function toJsonForm(value: unknown): unknown {
  if (value instanceof RegExp) return { regex: value.source, flags: value.flags };
  if (Array.isArray(value)) return value.map(toJsonForm);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(value)) {
    if (item !== undefined) define(out, name, toJsonForm(item));
  }
  return out;
}

interface KeyBuilderResult {
  keyBuilder: KeyBuilder | undefined;
  /** keys.keyBuilder is "[function]" in the snapshot. */
  inSnapshot: boolean;
  issue?: ConfigIssue;
}

/** Takes keys.keyBuilder out of the JSON form; the schema knows only its snapshot form. */
function takeKeyBuilder(
  document: unknown,
  source: NonNullable<ConfigOverrides['source']>,
): KeyBuilderResult {
  const keys = valueAt(document, ['keys']);
  if (!isPlainObject(keys) || !Object.hasOwn(keys, 'keyBuilder')) {
    return { keyBuilder: undefined, inSnapshot: false };
  }
  const value = keys.keyBuilder;
  delete keys.keyBuilder;
  const path: Segment[] = ['keys', 'keyBuilder'];
  if (source === 'json') {
    return {
      keyBuilder: undefined,
      inSnapshot: false,
      issue: issue(
        'CONFIG_INVALID_TYPE',
        path,
        'is not allowed in a JSON config file; a key builder must be a function',
        'Move the config to a .ts or .js file to use a keyBuilder function, or remove the option.',
      ),
    };
  }
  if (source === 'snapshot') {
    if (value === KEY_BUILDER_SNAPSHOT) return { keyBuilder: undefined, inSnapshot: true };
    return {
      keyBuilder: undefined,
      inSnapshot: false,
      issue: issue(
        'CONFIG_INVALID_TYPE',
        path,
        `must be "${KEY_BUILDER_SNAPSHOT}" in a config snapshot, got ${describeValue(value)}`,
        'The run report stores a key builder function as "[function]"; do not edit the snapshot.',
      ),
    };
  }
  if (typeof value === 'function') {
    return { keyBuilder: value as KeyBuilder, inSnapshot: true };
  }
  return {
    keyBuilder: undefined,
    inSnapshot: false,
    issue: issue(
      'CONFIG_INVALID_TYPE',
      path,
      `must be a function, got ${describeValue(value)}`,
      'Pass a function (req) => string | undefined; return undefined to use the built-in normalization.',
    ),
  };
}

/** Copy of arrays and objects; other values (including invalid ones) are kept as they are. */
function clone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clone);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(value)) define(out, name, clone(item));
  return out;
}

/**
 * Objects are merged recursively; arrays and all other values replace the default as a whole
 * (03-REQ-06, 03-D-02). The result shares nothing with its arguments.
 */
function merge(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) return clone(override);
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(base)) define(out, name, clone(value));
  for (const [name, value] of Object.entries(override)) {
    define(
      out,
      name,
      Object.hasOwn(base, name) ? merge(base[name], value) : merge(undefined, value),
    );
  }
  return out;
}

/** Index of every path in the input, depth first, to sort issues in input order (03-REQ-09). */
function inputOrder(document: unknown): Map<string, number> {
  const order = new Map<string, number>();
  const visit = (node: unknown, prefix: Segment[]): void => {
    const entries: [Segment, unknown][] = Array.isArray(node)
      ? node.map((item, index): [Segment, unknown] => [index, item])
      : isRecord(node)
        ? Object.entries(node)
        : [];
    for (const [segment, value] of entries) {
      const path = [...prefix, segment];
      order.set(formatPath(path), order.size);
      visit(value, path);
    }
  };
  visit(document, []);
  return order;
}

function sortByInput(issues: ConfigIssue[], order: Map<string, number>): ConfigIssue[] {
  const position = (path: string | undefined): number => {
    let candidate = path ?? '';
    while (candidate !== '') {
      const found = order.get(candidate);
      if (found !== undefined) return found;
      const cut = Math.max(candidate.lastIndexOf('.'), candidate.lastIndexOf('['));
      candidate = cut <= 0 ? '' : candidate.slice(0, cut);
    }
    return Number.POSITIVE_INFINITY;
  };
  return issues
    .map((item, index) => ({ item, index, at: position(item.path) }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map(({ item }) => item);
}

function overrideIssues(overrides: ConfigOverrides): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  if (overrides.env !== undefined && !matches(envLabelOrNull, overrides.env)) {
    issues.push(
      issue(
        'CONFIG_INVALID_VALUE',
        ['run', 'env'],
        `the environment override must be null or a label of lowercase letters, digits and "-" (at most 32 characters), got ${describeValue(overrides.env)}`,
        'Fix the environment label, e.g. "staging".',
      ),
    );
  }
  if (overrides.passes !== undefined && !matches(passesSchema, overrides.passes)) {
    issues.push(
      issue(
        'CONFIG_INVALID_VALUE',
        ['run', 'passes', overrides.mode ?? 'test'],
        `the passes override must be an integer from 1 to 1000, got ${describeValue(overrides.passes)}`,
        'Fix the number of passes, e.g. 5.',
      ),
    );
  }
  return issues;
}

function applyOverrides(config: ResolvedConfigJson, overrides: ConfigOverrides): void {
  if (overrides.env !== undefined) config.run.env = overrides.env;
  if (overrides.thresholdsDir !== undefined) config.thresholds.dir = overrides.thresholdsDir;
  if (overrides.minSamples !== undefined) {
    const median = config.checks.time.median;
    median.minSamples = Math.min(median.minSamples, overrides.minSamples);
  }
  if (overrides.passes !== undefined) {
    config.run.passes[overrides.mode === 'thresholds' ? 'thresholds' : 'test'] = overrides.passes;
  }
}

type JsonPattern = string | { regex: string; flags?: string };

function snapshotPattern(pattern: JsonPattern): JsonPattern {
  return typeof pattern === 'string'
    ? pattern
    : { regex: pattern.regex, flags: pattern.flags ?? '' };
}

/**
 * Compiles a pattern. The g and y flags are dropped: they make RegExp.test() depend on the
 * previous call (03, chapter 5; 07-REQ-09). The snapshot keeps the flags as given.
 */
function compilePattern(pattern: JsonPattern): ResolvedUrlPattern {
  if (typeof pattern === 'string') return pattern;
  return new RegExp(pattern.regex, (pattern.flags ?? '').replace(/[gy]/g, ''));
}

/**
 * Resolves the package config: schema defaults, the margins of thresholds.preset, then `input`,
 * then `overrides` (03-REQ-04).
 * Returns every problem at once (03-REQ-09); warnings come with a successful result.
 */
export function resolveConfig(
  input: PerfConfigInput | undefined,
  overrides: ConfigOverrides,
): Result<ResolvedConfigResult, ConfigIssue> {
  const source = overrides.source ?? 'code';
  const document = toJsonForm(input ?? {});
  const keyBuilder = takeKeyBuilder(document, source);
  const order = inputOrder(document);

  const errors: ConfigIssue[] = [
    ...(keyBuilder.issue === undefined ? [] : [keyBuilder.issue]),
    ...schemaIssues(document),
    ...regexIssues(document),
    ...overrideIssues(overrides),
  ];

  // The checks between options run on the merged config even when some options are invalid,
  // so that all problems are reported together; they skip values of the wrong type.
  const { $schema: _schema, ...withoutSchema } = isRecord(document) ? document : {};
  // The margins of thresholds.preset sit between the defaults and the input (03-REQ-24).
  const defaults = merge(DEFAULT_CONFIG, presetLayer(presetOf(withoutSchema)));
  const merged = merge(defaults, withoutSchema) as ResolvedConfigJson;
  if (errors.length === 0) applyOverrides(merged, overrides);
  const relational = relationalIssues(merged, (path) => order.has(formatPath(path)));
  errors.push(...relational.errors);
  if (errors.length > 0) return { ok: false, issues: sortByInput(errors, order) };

  // measure.steps becomes the full object before the pattern lists inside it are normalized.
  merged.measure.steps = expandSteps(merged.measure.steps as Parameters<typeof expandSteps>[0]);
  for (const path of PATTERN_LISTS) {
    const list = valueAt(merged, path) as JsonPattern[];
    list.splice(0, list.length, ...list.map(snapshotPattern));
  }
  for (const entry of merged.keys.operations) entry.match = snapshotPattern(entry.match);
  if (keyBuilder.inSnapshot) merged.keys.keyBuilder = KEY_BUILDER_SNAPSHOT;
  const snapshot = merged;

  const { keyBuilder: _keyBuilder, ...keys } = snapshot.keys;
  const copy = clone(snapshot) as ResolvedConfigJson;
  const config: ResolvedConfig = {
    ...copy,
    measure: {
      ...copy.measure,
      include: snapshot.measure.include.map(compilePattern),
      exclude: snapshot.measure.exclude.map(compilePattern),
      steps: {
        ...copy.measure.steps,
        include: snapshot.measure.steps.include.map(compilePattern),
        exclude: snapshot.measure.steps.exclude.map(compilePattern),
      },
    },
    keys: {
      ...(clone(keys) as typeof keys),
      extraIdPatterns: snapshot.keys.extraIdPatterns.map(compilePattern),
      keyBuilder: keyBuilder.keyBuilder,
      operations: snapshot.keys.operations.map((entry) => ({
        type: entry.type,
        match: compilePattern(entry.match),
      })),
    },
  };
  return {
    ok: true,
    value: {
      config,
      snapshot,
      warnings: sortByInput(relational.warnings, order),
    },
  };
}
