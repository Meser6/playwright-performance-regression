// Config validation with CONFIG_* codes (03, chapters 8 and 9): schema problems mapped to codes
// with "did you mean" suggestions (03-REQ-12), regexes, and the checks between options that
// the schema cannot express (03-REQ-10).
import type { ConfigIssue } from '../types/common.ts';
import { packageConfig } from '../schema/config.ts';
import { isRecord, Sink } from '../schema/dsl.ts';
import type { Problem } from '../schema/dsl.ts';
import { DEFAULT_CONFIG } from './generated/defaults.ts';
import { isHostPattern, parseHostPattern } from '../normalize/host-patterns.ts';
import { STEP_DEFAULTS, STEP_OPTION_NAMES } from './steps.ts';
import { describeValue, editDistance, formatPath, pointerSegments, valueAt } from './paths.ts';
import type { Segment } from './paths.ts';

export type ConfigIssueCode =
  | 'CONFIG_UNKNOWN_OPTION'
  | 'CONFIG_INVALID_TYPE'
  | 'CONFIG_INVALID_VALUE'
  | 'CONFIG_INVALID_REGEX'
  | 'CONFIG_DUPLICATE_ORIGIN_LABEL'
  | 'CONFIG_RESOURCE_TYPE_LONG_LIVED'
  | 'CONFIG_PERCENTILE_IS_P99';

const SCHEMA_FILE = 'schemas/config.schema.json';
/** Hint for the options of the removed custom measurements (03-REQ-19, D-32). */
const REMOVED_CUSTOM_HINT =
  'custom measurements were removed in 0.1.0-next.2; use measure.steps and limit.step (test.step durations) instead.';
const MAX_SUGGESTION_DISTANCE = 2;
/** Validation reports every problem (03-REQ-09); the cap only guards against huge inputs. */
const MAX_SCHEMA_PROBLEMS = 1000;

/** Option lists whose items are URL patterns (03, chapter 5). */
export const PATTERN_LISTS: readonly (readonly string[])[] = [
  ['measure', 'include'],
  ['measure', 'exclude'],
  ['measure', 'steps', 'include'],
  ['measure', 'steps', 'exclude'],
  ['keys', 'extraIdPatterns'],
];

/** Environment labels that equal a thresholds file name part (02-REQ-35, 03-REQ-22). */
export const RESERVED_ENV_LABELS: readonly string[] = ['steps', 'requests'];

export function reservedEnvIssue(segments: readonly Segment[], label: string): ConfigIssue {
  return issue(
    'CONFIG_INVALID_VALUE',
    segments,
    `the environment label ${JSON.stringify(label)} is reserved: it is a part of the thresholds file names (pw-perf-thresholds.${label}.json)`,
    `Use another environment label, e.g. "${label}-env".`,
  );
}

export function issue(
  code: ConfigIssueCode,
  segments: readonly Segment[],
  message: string,
  hint: string,
): ConfigIssue {
  const path = formatPath(segments);
  return { code, path, message: `${path === '' ? 'config' : path}: ${message}`, hint };
}

function isPatternItem(segments: readonly Segment[]): boolean {
  return (
    typeof segments.at(-1) === 'number' &&
    PATTERN_LISTS.some(
      (list) =>
        segments.length === list.length + 1 && list.every((name, i) => segments[i] === name),
    )
  );
}

/** Known option names inside the object at `parent`. */
function knownOptions(parent: readonly Segment[]): string[] {
  if (isPatternItem(parent)) return ['regex', 'flags'];
  if (parent[0] === 'keys' && parent[1] === 'origins') return [];
  if (parent.length === 2 && parent[0] === 'measure' && parent[1] === 'steps') {
    return [...STEP_OPTION_NAMES];
  }
  const node = valueAt(DEFAULT_CONFIG, parent);
  const names = isRecord(node) ? Object.keys(node) : [];
  if (parent.length === 0) names.push('$schema');
  if (parent.length === 1 && parent[0] === 'keys') names.push('keyBuilder');
  return names;
}

/** Paths of every option with a default, depth first. */
function allOptionPaths(node: unknown, prefix: Segment[] = []): Segment[][] {
  if (!isRecord(node) || (prefix[0] === 'keys' && prefix[1] === 'origins')) return [];
  return Object.entries(node).flatMap(([name, value]) => [
    [...prefix, name],
    ...allOptionPaths(value, [...prefix, name]),
  ]);
}

/** The closest known option (03-REQ-12): a sibling within distance 2, else the same name elsewhere. */
export function suggestOption(parent: readonly Segment[], name: string): string | undefined {
  let best: { name: string; distance: number } | undefined;
  for (const candidate of knownOptions(parent)) {
    const distance = editDistance(name, candidate);
    if (distance <= MAX_SUGGESTION_DISTANCE && (best === undefined || distance < best.distance)) {
      best = { name: candidate, distance };
    }
  }
  if (best !== undefined) return formatPath([...parent, best.name]);
  const moved = allOptionPaths(DEFAULT_CONFIG).find((path) => path.at(-1) === name);
  return moved === undefined ? undefined : formatPath(moved);
}

/**
 * True for `custom` in a limit object of a rule (checks.<group>.<rule>.limit, checks.errors.limit)
 * or in checks.slowShare.t: options of the removed custom measurements (03-REQ-19).
 */
function isRemovedCustomOption(parent: readonly Segment[], name: string): boolean {
  if (name !== 'custom' || parent[0] !== 'checks') return false;
  if (parent.at(-1) === 'limit') return true;
  return parent.length === 3 && parent[1] === 'slowShare' && parent[2] === 't';
}

/** Hint with the expected format: the default value as an example, when there is one. */
function exampleHint(segments: readonly Segment[]): string {
  let example =
    segments[0] === 'measure' && segments[1] === 'steps' && segments.length > 2
      ? valueAt(STEP_DEFAULTS, segments.slice(2))
      : valueAt(DEFAULT_CONFIG, segments);
  if (example === undefined && typeof segments.at(-1) === 'number') {
    const list = valueAt(DEFAULT_CONFIG, segments.slice(0, -1));
    if (Array.isArray(list)) example = list[0];
  }
  const shown = example === undefined || isRecord(example) ? undefined : describeValue(example);
  const prefix = shown === undefined || shown.endsWith('…') ? '' : `Default: ${shown}. `;
  return `${prefix}${SCHEMA_FILE} in the package lists every option and its format.`;
}

function problemToIssue(problem: Problem, document: unknown): ConfigIssue {
  const segments = pointerSegments(problem.pointer, document);
  if (problem.kind === 'unknown' && problem.property !== undefined) {
    const option = [...segments, problem.property];
    if (isRemovedCustomOption(segments, problem.property)) {
      return issue('CONFIG_UNKNOWN_OPTION', option, 'unknown option', REMOVED_CUSTOM_HINT);
    }
    if (
      problem.property === 'keepQuotedValues' &&
      segments.length === 2 &&
      segments[0] === 'measure' &&
      segments[1] === 'steps'
    ) {
      return issue(
        'CONFIG_UNKNOWN_OPTION',
        option,
        'unknown option',
        'keepQuotedValues was renamed to redactQuotedValues with the opposite meaning: quoted values stay in step keys by default; set measure.steps.redactQuotedValues to true to replace them.',
      );
    }
    if (problem.property === 'repeat' && segments.length === 1 && segments[0] === 'run') {
      return issue(
        'CONFIG_UNKNOWN_OPTION',
        option,
        'unknown option',
        'Renamed to run.passes: the test command now runs once per pass (repeatEach is 1); e.g. run: { passes: { test: 5, thresholds: 10 } }.',
      );
    }
    const suggestion = suggestOption(segments, problem.property);
    return issue(
      'CONFIG_UNKNOWN_OPTION',
      option,
      suggestion === undefined ? 'unknown option' : `unknown option. Did you mean "${suggestion}"?`,
      suggestion === undefined
        ? `Remove it or fix the name; ${SCHEMA_FILE} in the package lists every option.`
        : `Rename it to "${suggestion}".`,
    );
  }
  const got =
    problem.kind === 'name'
      ? JSON.stringify(problem.property)
      : describeValue(valueAt(document, segments));
  return issue(
    problem.kind === 'type' ? 'CONFIG_INVALID_TYPE' : 'CONFIG_INVALID_VALUE',
    segments,
    `${problem.message}, got ${got}`,
    exampleHint(segments),
  );
}

/** Schema problems of the JSON form of the input, in the order of the input (03-REQ-09). */
export function schemaIssues(document: unknown): ConfigIssue[] {
  const sink = new Sink(MAX_SCHEMA_PROBLEMS);
  packageConfig.check(document, '', sink);
  return sink.problems.map((problem) => problemToIssue(problem, document));
}

/** CONFIG_INVALID_REGEX for every { regex, flags } pattern that does not compile. */
export function regexIssues(document: unknown): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const path of PATTERN_LISTS) {
    const list = valueAt(document, path);
    if (!Array.isArray(list)) continue;
    list.forEach((item: unknown, index) => {
      if (!isRecord(item) || typeof item.regex !== 'string') return;
      const flags = typeof item.flags === 'string' ? item.flags : '';
      try {
        new RegExp(item.regex, flags);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        issues.push(
          issue(
            'CONFIG_INVALID_REGEX',
            [...path, index],
            `regular expression does not compile (${reason})`,
            'Fix the expression; it uses JavaScript RegExp syntax, e.g. { "regex": "^/api/v[0-9]+/", "flags": "i" }.',
          ),
        );
      }
    });
  }
  return issues;
}

const numberAt = (config: unknown, segments: readonly Segment[]): number | undefined => {
  const value = valueAt(config, segments);
  return typeof value === 'number' ? value : undefined;
};

/** Rules of `checks`, as paths relative to the config root (03-REQ-17). */
const RULES: readonly (readonly string[])[] = [
  ['checks', 'time', 'median'],
  ['checks', 'time', 'percentile'],
  ['checks', 'time', 'p99'],
  ['checks', 'slowShare', 'apdex'],
  ['checks', 'slowShare', 'wilson'],
  ['checks', 'errors'],
];
const KINDS = ['api', 'step'] as const;
const MIN_PERCENTILE = 50;

function percentileLevel(name: unknown): number | undefined {
  if (typeof name !== 'string' || !/^p\d+(?:\.\d)?$/u.test(name)) return undefined;
  return Number(name.slice(1));
}

export interface RelationalResult {
  errors: ConfigIssue[];
  warnings: ConfigIssue[];
}

/**
 * Checks between options on the merged config (03-REQ-10). `isSet` tells whether the user set
 * a path; an issue about two options names the one the user set.
 */
export function relationalIssues(
  config: unknown,
  isSet: (segments: readonly Segment[]) => boolean,
): RelationalResult {
  const errors: ConfigIssue[] = [];
  const warnings: ConfigIssue[] = [];
  /**
   * Requires the value at `low` to be <= the value at `high`. The issue is about the option
   * the user set; when both or neither are set, about `high`.
   */
  const ordered = (low: Segment[], high: Segment[], hint: string): void => {
    const a = numberAt(config, low);
    const b = numberAt(config, high);
    if (a === undefined || b === undefined || a <= b) return;
    const onLow = isSet(low) && !isSet(high);
    errors.push(
      onLow
        ? issue(
            'CONFIG_INVALID_VALUE',
            low,
            `must be <= ${formatPath(high)} (${b}), got ${a}`,
            hint,
          )
        : issue(
            'CONFIG_INVALID_VALUE',
            high,
            `must be >= ${formatPath(low)} (${a}), got ${b}`,
            hint,
          ),
    );
  };

  // Limits never decrease from median to percentile to p99, per kind.
  const limit = (rule: string, kind: string): Segment[] => ['checks', 'time', rule, 'limit', kind];
  const limitHint =
    'Time limits must not decrease from median to percentile to p99; raise the higher limit or lower the other one.';
  for (const kind of KINDS) {
    ordered(limit('percentile', kind), limit('p99', kind), limitHint);
    ordered(limit('median', kind), limit('percentile', kind), limitHint);
  }

  // Bounds of T and of the Wilson margin.
  const boundsHint = 'Set the lower bound at most equal to the upper bound.';
  for (const kind of KINDS) {
    const t: Segment[] = ['checks', 'slowShare', 't', kind];
    ordered([...t, 'min'], [...t, 'max'], boundsHint);
  }
  const wilsonMargin: Segment[] = ['checks', 'slowShare', 'wilson', 'margin'];
  ordered([...wilsonMargin, 'min'], [...wilsonMargin, 'max'], boundsHint);

  // Percentile level at least p50; p99 duplicates the p99 rule.
  const levelPath = ['checks', 'time', 'percentile', 'level'];
  const level = percentileLevel(valueAt(config, levelPath));
  if (level !== undefined && level < MIN_PERCENTILE) {
    errors.push(
      issue(
        'CONFIG_INVALID_VALUE',
        levelPath,
        `must be at least "p50", got ${describeValue(valueAt(config, levelPath))}`,
        'A percentile below the median could give a lower limit than the median rule; use a level like "p90" or "p95".',
      ),
    );
  } else if (level === 99) {
    warnings.push(
      issue(
        'CONFIG_PERCENTILE_IS_P99',
        levelPath,
        'the percentile rule checks p99, the same as the p99 rule',
        'Use a lower level such as "p95", or disable checks.time.p99.',
      ),
    );
  }

  // minSamples of every rule at least that of the median rule.
  for (const rule of RULES.slice(1)) {
    ordered(
      ['checks', 'time', 'median', 'minSamples'],
      [...rule, 'minSamples'],
      'The median rule needs the fewest samples; raise this minSamples or lower the median one.',
    );
  }

  // At least one rule enabled unless the gate only warns.
  const enabled = RULES.some((rule) => valueAt(config, [...rule, 'enabled']) !== false);
  if (!enabled && valueAt(config, ['gate', 'warnOnly']) !== true) {
    errors.push(
      issue(
        'CONFIG_INVALID_VALUE',
        ['checks'],
        'every rule is disabled, so nothing would be checked',
        'Enable at least one rule in checks, or set gate.warnOnly to true.',
      ),
    );
  }

  // Environment labels that collide with thresholds file names (03-REQ-22).
  const env = valueAt(config, ['run', 'env']);
  if (typeof env === 'string' && RESERVED_ENV_LABELS.includes(env)) {
    errors.push(reservedEnvIssue(['run', 'env'], env));
  }

  // Host patterns in keys.origins (03-REQ-20).
  const originMap = valueAt(config, ['keys', 'origins']);
  if (isRecord(originMap)) {
    const seen = new Map<string, string>();
    for (const [key, label] of Object.entries(originMap)) {
      if (!isHostPattern(key) || typeof label !== 'string') continue;
      const parsed = parseHostPattern(key, label);
      if (typeof parsed === 'string') {
        errors.push(
          issue(
            'CONFIG_INVALID_VALUE',
            ['keys', 'origins', key],
            parsed,
            'Write a host pattern like "https://*.ci.example.com": one "*" inside a host label, a top-level domain without "*" (docs/dynamic-environments.md).',
          ),
        );
        continue;
      }
      const other = seen.get(parsed.canonical);
      if (other !== undefined) {
        errors.push(
          issue(
            'CONFIG_INVALID_VALUE',
            ['keys', 'origins', key],
            `the host pattern is the same as ${JSON.stringify(other)} after canonicalization (${parsed.canonical})`,
            'Keep one of the two patterns.',
          ),
        );
      } else {
        seen.set(parsed.canonical, key);
      }
    }
  }

  // Origins that share a label (their keys merge, 07).
  const origins = valueAt(config, ['keys', 'origins']);
  if (isRecord(origins)) {
    const byLabel = new Map<string, string[]>();
    for (const [origin, label] of Object.entries(origins)) {
      // A pattern and exact entries may share a label on purpose (03-REQ-20).
      if (typeof label !== 'string' || isHostPattern(origin)) continue;
      byLabel.set(label, [...(byLabel.get(label) ?? []), origin]);
    }
    for (const [label, list] of byLabel) {
      if (list.length < 2) continue;
      warnings.push(
        issue(
          'CONFIG_DUPLICATE_ORIGIN_LABEL',
          ['keys', 'origins'],
          `${list.map((o) => JSON.stringify(o)).join(', ')} share the label ${JSON.stringify(label)}, so their endpoint keys are merged`,
          'Give each origin its own label unless merging their keys is intended.',
        ),
      );
    }
  }

  // eventsource requests usually stay open and become PENDING samples (05).
  const resourceTypes = valueAt(config, ['measure', 'resourceTypes']);
  if (Array.isArray(resourceTypes) && resourceTypes.includes('eventsource')) {
    warnings.push(
      issue(
        'CONFIG_RESOURCE_TYPE_LONG_LIVED',
        ['measure', 'resourceTypes'],
        'includes "eventsource"; server-sent event connections usually stay open and are recorded as PENDING samples',
        'Remove "eventsource" unless its requests finish within the test.',
      ),
    );
  }

  return { errors, warnings };
}
