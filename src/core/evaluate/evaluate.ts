// Evaluation of all keys and the gate decision (09, chapters 4–7).
import type { ResolvedConfig } from '../config/index.ts';
import { SCHEMA_VERSIONS, schemaIssueToIssue } from '../schema/index.ts';
import type { Aggregates } from '../stats/index.ts';
import type {
  AggregateStats,
  EvaluationCounts,
  Issue,
  EvaluatedKey,
  Kind,
  ThresholdFileInfo,
} from '../types/index.ts';
import { CLI_COMMAND, KINDS } from '../types/index.ts';
import {
  compareText,
  fileInfo,
  generatedWarnings,
  missingFileWarning,
  outdatedWarning,
  plural,
  unseenWarning,
} from './files.ts';
import { defaultLimits, entryLimits } from './limits.ts';
import { dayOf, isMuteActive, keyMuting, mutingWarnings } from './muting.ts';
import type { MutedKey } from './muting.ts';
import { TIME_RULES, runRules } from './rules.ts';
import { sourceForKind } from './types.ts';
import type { EvaluateOptions, Evaluation, EvaluationStatus, LoadedThresholds } from './types.ts';

/**
 * Number of keys with qualified violations that is still tolerated (09-REQ-13, step 5): the
 * integer tolerance, or floor(percent × E / 100) computed on integers so that e.g. "5%" of 40
 * is exactly 2.
 */
export function allowedViolations(tolerance: number | string, evaluated: number): number {
  if (typeof tolerance === 'number') return tolerance;
  const match = /^(\d+)(?:\.(\d+))?%$/u.exec(tolerance);
  if (match === null) throw new Error(`evaluate: invalid gate.tolerance "${tolerance}"`);
  const decimals = match[2] ?? '';
  const scale = 10 ** decimals.length;
  const scaledPercent = Number(match[1]) * scale + (decimals === '' ? 0 : Number(decimals));
  return Math.floor((scaledPercent * evaluated) / (100 * scale));
}

/** Evaluates one key without the gate: limits, checks, result and muting (09, chapter 5). */
function evaluateKey(
  key: string,
  stats: AggregateStats,
  kind: Kind,
  thresholds: LoadedThresholds,
  cfg: ResolvedConfig,
  runDay: string,
): EvaluatedKey {
  const file = thresholds[kind];
  if (file.status === 'invalid') {
    // Informational limits only; never evaluated with default thresholds (09-REQ-12).
    return {
      result: 'not-evaluated',
      reason: 'thresholds-error',
      thresholdSource: 'default',
      limits: defaultLimits(cfg.checks, kind),
      checks: [],
      muted: null,
    };
  }
  const entries = file.status === 'loaded' ? file.file.entries : {};
  const entry = Object.hasOwn(entries, key) ? entries[key] : undefined;
  const limits =
    entry === undefined ? defaultLimits(cfg.checks, kind) : entryLimits(entry, cfg.checks, kind);
  const { checks, applicable } = runRules(stats, limits, cfg);
  return {
    result: checks.length === 0 ? 'not-evaluated' : checks.some((c) => !c.passed) ? 'fail' : 'pass',
    reason: checks.length > 0 ? null : applicable ? 'too-few-samples' : 'no-rules',
    thresholdSource: entry === undefined ? 'default' : 'file',
    limits,
    checks,
    muted: entry === undefined ? null : keyMuting(entry, runDay),
  };
}

/** Violations of this key may block the run (09-REQ-13, step 2). */
function qualifies(evaluation: EvaluatedKey, gate: ResolvedConfig['gate']): boolean {
  if (gate.warnOnly) return false;
  if (evaluation.thresholdSource === 'default' && gate.defaultThresholds === 'warn') return false;
  return !isMuteActive(evaluation.muted);
}

/** Sets `blocking` of every check (09-REQ-13, steps 1–6). */
function applyGate(
  perKey: Record<Kind, Record<string, EvaluatedKey>>,
  gate: ResolvedConfig['gate'],
): void {
  const all = KINDS.flatMap((kind) => Object.values(perKey[kind]));
  const qualified = all.filter(
    (e) => qualifies(e, gate) && e.checks.some((check) => !check.passed),
  );
  const evaluated = all.filter((e) => e.result !== 'not-evaluated').length;
  const overTolerance = qualified.length > allowedViolations(gate.tolerance, evaluated);
  for (const evaluation of qualified) {
    for (const check of evaluation.checks) {
      check.blocking = !check.passed && (overTolerance || check.hardLimitExceeded);
    }
  }
}

/** evaluation.counts.<kind> (09-REQ-17). */
function countKind(
  perKey: Record<string, EvaluatedKey>,
  unseenThresholdEntries: number,
): EvaluationCounts {
  const counts: EvaluationCounts = {
    keys: 0,
    fromFile: 0,
    fromDefaults: 0,
    notEvaluated: 0,
    tooFewSamples: 0,
    fileEntriesNotEvaluated: 0,
    medianOnly: 0,
    unseenThresholdEntries,
    violations: 0,
    blockingViolations: 0,
    muted: 0,
  };
  for (const e of Object.values(perKey)) {
    counts.keys += 1;
    if (isMuteActive(e.muted)) counts.muted += 1;
    if (e.result === 'not-evaluated') {
      counts.notEvaluated += 1;
      if (e.reason === 'too-few-samples') {
        counts.tooFewSamples += 1;
        if (e.thresholdSource === 'file') counts.fileEntriesNotEvaluated += 1;
      }
      continue;
    }
    if (e.thresholdSource === 'file') counts.fromFile += 1;
    else counts.fromDefaults += 1;
    const timeRules = e.checks.filter((c) => TIME_RULES.has(c.rule)).map((c) => c.rule);
    if (timeRules.length === 1 && timeRules[0] === 'median') counts.medianOnly += 1;
    if (e.result === 'fail') counts.violations += 1;
    if (e.checks.some((c) => c.blocking)) counts.blockingViolations += 1;
  }
  return counts;
}

/** evaluation.status (09-REQ-13, step 7). */
function evaluationStatus(
  perKey: Record<Kind, Record<string, EvaluatedKey>>,
  thresholds: LoadedThresholds,
  fatalToolError: boolean,
  kinds: readonly Kind[],
): EvaluationStatus {
  if (fatalToolError || kinds.some((kind) => thresholds[kind].status === 'invalid')) {
    return 'error';
  }
  const checks = KINDS.flatMap((kind) => Object.values(perKey[kind])).flatMap((e) => e.checks);
  if (checks.some((c) => c.blocking)) return 'failed';
  if (checks.some((c) => !c.passed)) return 'warned';
  return 'passed';
}

/**
 * Evaluates every key of the run against the thresholds files and the gate policy (09). Pure:
 * the reporter reads the files (09-REQ-01) and passes the result in `thresholds`.
 */
export function evaluate(
  aggregates: Pick<Aggregates, 'endpoints'> & Partial<Pick<Aggregates, 'steps'>>,
  thresholds: LoadedThresholds,
  cfg: ResolvedConfig,
  opts: EvaluateOptions,
): Evaluation {
  const runDay = dayOf(opts.startedAt);
  const byKind: Record<Kind, Record<string, AggregateStats>> = {
    api: aggregates.endpoints,
    step: aggregates.steps ?? {},
  };
  const perKey: Record<Kind, Record<string, EvaluatedKey>> = { api: {}, step: {} };
  for (const kind of KINDS) {
    for (const key of Object.keys(byKind[kind]).sort(compareText)) {
      const stats = byKind[kind][key];
      if (stats !== undefined) {
        perKey[kind][key] = evaluateKey(key, stats, kind, thresholds, cfg, runDay);
      }
    }
  }
  applyGate(perKey, cfg.gate);

  const warnings: Issue[] = [];
  const toolErrors: Issue[] = [];
  const thresholdFiles: ThresholdFileInfo[] = [];
  const unseenCount: Record<Kind, number> = { api: 0, step: 0 };
  // The step file is not read while measure.steps is off, even when it exists (09-REQ-31).
  const activeKinds = KINDS.filter((kind) => kind !== 'step' || cfg.measure.steps.enabled);
  for (const kind of activeKinds) {
    const file = thresholds[kind];
    if (file.kind !== kind) {
      throw new Error(`evaluate: thresholds.${kind} has kind "${file.kind}"`);
    }
    let unseen: string[] = [];
    if (file.status === 'missing') {
      // Only for a kind with keys in the run: a kind without keys does not need its file
      // (09-REQ-02, 09-D-17).
      if (Object.keys(byKind[kind]).length > 0) warnings.push(missingFileWarning(file, opts.env));
    } else if (file.status === 'invalid') {
      toolErrors.push(...file.issues.map(schemaIssueToIssue));
    } else {
      if (file.migratedFrom !== undefined) {
        warnings.push(outdatedWarning(file.path, file.migratedFrom, SCHEMA_VERSIONS.thresholds));
      }
      if (file.file.generated !== null) {
        warnings.push(
          ...generatedWarnings(
            file.path,
            file.file.generated,
            cfg,
            opts.env,
            sourceForKind(opts.source, kind),
          ),
        );
      }
      // A key is seen when it has an aggregate, even with n = 0 (09-REQ-05).
      unseen = Object.keys(file.file.entries)
        .filter((key) => !Object.hasOwn(byKind[kind], key))
        .sort(compareText);
      if (unseen.length > 0) warnings.push(unseenWarning(file.path, unseen));
    }
    unseenCount[kind] = unseen.length;
    thresholdFiles.push(fileInfo(file, unseen));
  }

  const counts: Record<Kind, EvaluationCounts> = {
    api: countKind(perKey.api, unseenCount.api),
    step: countKind(perKey.step, unseenCount.step),
  };

  if (KINDS.every((kind) => Object.keys(byKind[kind]).length === 0)) {
    warnings.push({
      code: 'EVAL_NO_SAMPLES',
      message: 'The run recorded no samples, so nothing was evaluated.',
      hint: 'Check the integration: tests must use the fixtures from withPerfFixtures, and the measure options (include, exclude, resourceTypes) must not filter out every request.',
    });
  }

  const notEvaluated = KINDS.reduce((sum, kind) => sum + counts[kind].fileEntriesNotEvaluated, 0);
  if (notEvaluated > 0) {
    warnings.push({
      code: 'THRESHOLDS_ENTRIES_NOT_EVALUATED',
      message: `${plural(notEvaluated, 'key')} with an entry in the thresholds file had too few samples and ${notEvaluated === 1 ? 'was' : 'were'} not evaluated.`,
      hint: `Run more repetitions (run.repeat or \`${CLI_COMMAND} test --repeat\`), or accept that the endpoint is called rarely.`,
    });
  }

  const mutedKeys: MutedKey[] = KINDS.flatMap((kind) =>
    Object.entries(perKey[kind]).flatMap(([key, e]) =>
      e.muted === null ? [] : [{ kind, key, muted: e.muted }],
    ),
  );
  warnings.push(...mutingWarnings(mutedKeys, runDay));

  return {
    status: evaluationStatus(perKey, thresholds, opts.fatalToolError, activeKinds),
    gateEnabled: opts.mode === 'test',
    counts,
    perKey,
    thresholdFiles,
    warnings,
    toolErrors,
  };
}
