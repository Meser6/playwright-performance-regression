// Thresholds files: state, checks of the `generated` block and unseen entries (09, chapter 4).
import type { ResolvedConfig } from '../config/index.ts';
import type { Generated, Issue, Kind, ThresholdFileInfo } from '../types/index.ts';
import { PRUNE_COMMAND, THRESHOLDS_COMMAND } from '../types/index.ts';
import type { LoadedThresholdsFile, RunSource } from './types.ts';

/** Code unit order, never localeCompare (02-REQ-04). */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

const KIND_NOUN: Record<Kind, string> = { api: 'endpoint', step: 'step' };

/** Path of the file without the environment label: <prefix>[.steps].<env>.json → <prefix>[.steps].json. */
function envlessPath(path: string, env: string): string {
  const suffix = `.${env}.json`;
  return path.endsWith(suffix) ? `${path.slice(0, -suffix.length)}.json` : path;
}

/** THRESHOLDS_FILE_MISSING (09-REQ-02, 09-REQ-03). */
export function missingFileWarning(
  file: Extract<LoadedThresholdsFile, { status: 'missing' }>,
  env: string | null,
): Issue {
  const derive = `Derive thresholds with \`${THRESHOLDS_COMMAND}\`${env === null ? '' : ` (environment "${env}")`}.`;
  const envless =
    env !== null && file.envlessFileExists
      ? ` ${envlessPath(file.path, env)} exists but is not used for environment "${env}": thresholds of another environment would give false alarms or hide regressions.`
      : '';
  return {
    code: 'THRESHOLDS_FILE_MISSING',
    message: `Thresholds file ${file.path} not found; ${KIND_NOUN[file.kind]} keys are evaluated with default thresholds.`,
    hint: `${derive}${envless}`,
  };
}

/**
 * THRESHOLDS_FILE_EMPTY (09-REQ-02, 09-D-21): a loaded file without entries, e.g. the empty file
 * the wizard creates (04-REQ-75); the hint is the one of a missing file.
 */
export function emptyFileWarning(path: string, kind: Kind, env: string | null): Issue {
  return {
    code: 'THRESHOLDS_FILE_EMPTY',
    message: `Thresholds file ${path} has no entries; ${KIND_NOUN[kind]} keys are evaluated with default thresholds.`,
    hint: `Derive thresholds with \`${THRESHOLDS_COMMAND}\`${env === null ? '' : ` (environment "${env}")`}.`,
  };
}

/** Keys named in the THRESHOLDS_KEYS_ON_DEFAULTS message; the console table lists them (09-REQ-36). */
export const MAX_KEYS_IN_MESSAGE = 3;

/**
 * THRESHOLDS_KEYS_ON_DEFAULTS (09-REQ-36, 09-D-22): keys evaluated with default thresholds
 * because a file with entries has no entry for them; one warning per kind. `keys` are sorted.
 */
export function keysOnDefaultsWarning(
  path: string,
  kind: Kind,
  keys: readonly string[],
  env: string | null,
): Issue {
  const one = keys.length === 1;
  const named = keys.slice(0, MAX_KEYS_IN_MESSAGE).join(', ');
  const rest = keys.length - MAX_KEYS_IN_MESSAGE;
  const list = rest > 0 ? `${named} and ${plural(rest, 'other key')}` : named;
  return {
    code: 'THRESHOLDS_KEYS_ON_DEFAULTS',
    message: `${plural(keys.length, `${KIND_NOUN[kind]} key`)} ${one ? 'has' : 'have'} no entry in ${path} and ${one ? 'is' : 'are'} evaluated with default thresholds: ${list}.`,
    hint: `New endpoints or steps, or keys renamed by a code or normalization change, get the default thresholds. Add entries with \`${THRESHOLDS_COMMAND}\`${env === null ? '' : ` (environment "${env}")`}; locked entries are kept.`,
  };
}

/** major.minor of a version such as 1.57.2 (09-REQ-04). */
export function majorMinor(version: string): string {
  return version.split('.').slice(0, 2).join('.');
}

export function sameList(a: readonly string[], b: readonly string[]): boolean {
  const x = [...new Set(a)].sort(compareText);
  const y = [...new Set(b)].sort(compareText);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

function listText(list: readonly string[]): string {
  const unique = [...new Set(list)].sort(compareText);
  return unique.length === 0 ? '(none)' : unique.join(', ');
}

/** Fields of `generated` that differ from the source fingerprint (09-REQ-04, 09-D-13). */
export interface SourceDifferences {
  /** One text per differing field: "<field> <thresholds> / <source>". */
  diffs: string[];
  /** browsers, playwrightVersion (major.minor) or host differ: the timings are not comparable. */
  timing: boolean;
  /** The normalization differs: the keys are not comparable. */
  keys: boolean;
  /** measure.coldSamples differs: other samples are timed (08-REQ-41). */
  cold: boolean;
}

export function sourceDifferences(generated: Generated, source: RunSource): SourceDifferences {
  const diffs: string[] = [];
  let timing = false;
  let keys = false;
  let cold = false;
  if (!sameList(generated.browsers, source.browsers)) {
    diffs.push(`browsers ${listText(generated.browsers)} / ${listText(source.browsers)}`);
    timing = true;
  }
  if (majorMinor(generated.playwrightVersion) !== majorMinor(source.playwrightVersion)) {
    diffs.push(`playwrightVersion ${generated.playwrightVersion} / ${source.playwrightVersion}`);
    timing = true;
  }
  const hostFields = ['platform', 'arch', 'ci', 'cpuCount', 'cpuModel'] as const;
  for (const field of hostFields) {
    const a = generated.host[field];
    const b = source.host[field];
    if (a !== b) {
      diffs.push(`host.${field} ${JSON.stringify(a)} / ${JSON.stringify(b)}`);
      timing = true;
    }
  }
  if (generated.normalization !== source.normalization) {
    diffs.push(`normalization ${generated.normalization} / ${source.normalization}`);
    keys = true;
  }
  // A file written by 1.0.x has no coldSamples: the field is not compared (09-REQ-04).
  if (
    generated.coldSamples !== undefined &&
    source.coldSamples !== undefined &&
    generated.coldSamples !== source.coldSamples
  ) {
    diffs.push(`coldSamples ${generated.coldSamples} / ${source.coldSamples}`);
    cold = true;
  }
  return { diffs, timing, keys, cold };
}

/** Hint of THRESHOLDS_SOURCE_MISMATCH for a different measure.coldSamples (09-REQ-04). */
export const COLD_SAMPLES_HINT = `Another measure.coldSamples changes which samples are timed: derive thresholds again with \`${THRESHOLDS_COMMAND}\`.`;

/** Warnings about the `generated` block of a loaded file (09-REQ-04). */
export function generatedWarnings(
  path: string,
  generated: Generated,
  cfg: Pick<ResolvedConfig, 'checks'>,
  env: string | null,
  source: RunSource,
): Issue[] {
  const issues: Issue[] = [];
  const level = cfg.checks.time.percentile.level;
  if (generated.evaluatedPercentile !== level) {
    issues.push({
      code: 'EVAL_PERCENTILE_MISMATCH',
      message: `Thresholds in ${path} were derived for ${generated.evaluatedPercentile}, but this run evaluates ${level}; the percentile limits are compared with ${level}.`,
      hint: `Derive thresholds again with \`${THRESHOLDS_COMMAND}\` after changing checks.time.percentile.level.`,
    });
  }
  if (generated.env !== env) {
    const show = (v: string | null): string => (v === null ? 'none' : `"${v}"`);
    issues.push({
      code: 'THRESHOLDS_ENV_MISMATCH',
      message: `Thresholds in ${path} were derived for environment ${show(generated.env)}, but this run uses environment ${show(env)}.`,
      hint: 'The file was probably copied or renamed by hand; derive thresholds for this environment.',
    });
  }

  // One warning per file with every differing field (09-REQ-04, 09-D-13).
  const { diffs, timing, keys, cold } = sourceDifferences(generated, source);
  if (diffs.length > 0) {
    const hints: string[] = [];
    if (timing) {
      hints.push(
        'Another machine, browser or Playwright version changes the timings: derive thresholds on the same infrastructure as the evaluation.',
      );
    }
    if (keys) {
      hints.push(
        `Another normalization changes the keys: derive thresholds again with \`${THRESHOLDS_COMMAND}\`.`,
      );
    }
    if (cold) hints.push(COLD_SAMPLES_HINT);
    issues.push({
      code: 'THRESHOLDS_SOURCE_MISMATCH',
      message: `Thresholds in ${path} come from a run with other conditions (thresholds / this run): ${diffs.join('; ')}.`,
      hint: hints.join(' '),
    });
  }
  return issues;
}

/** THRESHOLDS_UNSEEN_ENTRIES (09-REQ-05). */
export function unseenWarning(path: string, unseen: readonly string[]): Issue {
  return {
    code: 'THRESHOLDS_UNSEEN_ENTRIES',
    message: `${plural(unseen.length, 'entry', 'entries')} in ${path} ${unseen.length === 1 ? 'was' : 'were'} not seen in this run.`,
    hint: `Run the full suite, or remove stale entries with \`${PRUNE_COMMAND}\`.`,
  };
}

/** THRESHOLDS_FILE_OUTDATED (02-REQ-12). */
export function outdatedWarning(path: string, from: number, current: number): Issue {
  return {
    code: 'THRESHOLDS_FILE_OUTDATED',
    message: `Thresholds file ${path} has format version ${from}; it was read after migration to version ${current}.`,
    hint: `The next thresholds run (\`${THRESHOLDS_COMMAND}\`) writes it in the current version and keeps locked entries.`,
  };
}

/** thresholdFiles[] entry of the run report. */
export function fileInfo(file: LoadedThresholdsFile, unseenKeys: string[]): ThresholdFileInfo {
  return {
    kind: file.kind,
    path: file.path,
    status: file.status,
    generated:
      file.status === 'loaded' && file.file.generated !== null
        ? structuredClone(file.file.generated)
        : null,
    unseenKeys,
  };
}
