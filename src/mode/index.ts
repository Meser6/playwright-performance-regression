// Mode contract (01, chapter 4.2): the only place that names and parses the PW_PERF_*
// environment variables (01-REQ-05, 00 chapter 14.1). Pure: the caller passes the environment.
import type { ModeIssue, Result } from '../core/types/index.ts';

export interface PerfModeState {
  mode: 'test' | 'thresholds';
  repeat?: number;
  env?: string;
  runId?: string;
  outcomeFile?: string;
  prune?: boolean;
}

export type ModeEnv = Readonly<Record<string, string | undefined>>;

const MODE = 'PW_PERF_MODE';
const REPEAT = 'PW_PERF_REPEAT';
const ENV = 'PW_PERF_ENV';
const RUN_ID = 'PW_PERF_RUN_ID';
const OUTCOME_FILE = 'PW_PERF_OUTCOME_FILE';
const PRUNE = 'PW_PERF_PRUNE';

/** Every variable of the contract (01, chapter 6), e.g. for CLI_MODE_ALREADY_SET (04-REQ-09). */
export const MODE_ENV_NAMES: readonly string[] = [MODE, REPEAT, ENV, RUN_ID, OUTCOME_FILE, PRUNE];

const POSITIVE_INTEGER = /^[1-9][0-9]*$/u;
const ENV_LABEL = /^[a-z0-9-]{1,32}$/u;

/** An empty variable counts as unset (03, chapter 10). */
function read(env: ModeEnv, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
}

function invalid(name: string, expected: string, value: string, hint: string): ModeIssue {
  return {
    code: 'MODE_INVALID_VALUE',
    message: `${name}: expected ${expected}, got ${JSON.stringify(value)}`,
    hint,
  };
}

/**
 * Perf mode state from the environment, or null when perf mode is off (no PW_PERF_MODE).
 * Invalid values are errors, never a silent "off" (01-REQ-27); all of them are reported.
 */
export function readModeState(env: ModeEnv): Result<PerfModeState | null, ModeIssue> {
  const mode = read(env, MODE);
  if (mode === undefined) return { ok: true, value: null };

  const issues: ModeIssue[] = [];
  if (mode !== 'test' && mode !== 'thresholds') {
    issues.push(
      invalid(
        MODE,
        '"test" or "thresholds"',
        mode,
        `Unset ${MODE} to run without perf mode, or start the run with "npx pw-perf test".`,
      ),
    );
  }
  const state: PerfModeState = { mode: mode === 'thresholds' ? 'thresholds' : 'test' };

  const repeat = read(env, REPEAT);
  if (repeat !== undefined) {
    if (POSITIVE_INTEGER.test(repeat)) state.repeat = Number(repeat);
    else {
      issues.push(
        invalid(
          REPEAT,
          'an integer >= 1, like "5"',
          repeat,
          `Fix the number of repetitions per test, or unset ${REPEAT} to use run.repeat from the config.`,
        ),
      );
    }
  }

  const label = read(env, ENV);
  if (label !== undefined) {
    if (ENV_LABEL.test(label)) state.env = label;
    else {
      issues.push(
        invalid(
          ENV,
          'a label of lowercase letters, digits and "-" (at most 32 characters), like "staging"',
          label,
          `Fix the environment label, or unset ${ENV} to use run.env from the config.`,
        ),
      );
    }
  }

  const runId = read(env, RUN_ID);
  if (runId !== undefined) state.runId = runId;
  const outcomeFile = read(env, OUTCOME_FILE);
  if (outcomeFile !== undefined) state.outcomeFile = outcomeFile;

  const prune = read(env, PRUNE);
  if (prune !== undefined) {
    if (prune === '1') state.prune = true;
    else {
      issues.push(
        invalid(
          PRUNE,
          '"1"',
          prune,
          `Set ${PRUNE}=1 to remove unlocked entries not seen in the run, or unset it.`,
        ),
      );
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: state };
}

/** Variables for a child process that runs in the given mode (04-REQ-09); unset fields are left out. */
export function writeModeState(state: PerfModeState): Record<string, string> {
  const env: Record<string, string> = { [MODE]: state.mode };
  if (state.repeat !== undefined) env[REPEAT] = String(state.repeat);
  if (state.env !== undefined) env[ENV] = state.env;
  if (state.runId !== undefined) env[RUN_ID] = state.runId;
  if (state.outcomeFile !== undefined) env[OUTCOME_FILE] = state.outcomeFile;
  if (state.prune === true) env[PRUNE] = '1';
  return env;
}

/** CI detection of the default console reporter (04-REQ-32), the same as Playwright's own. */
export function isCiEnv(env: ModeEnv): boolean {
  return read(env, 'CI') !== undefined;
}
