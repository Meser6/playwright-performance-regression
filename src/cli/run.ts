// `test` and `thresholds`: runs `playwright test` in perf mode (04, chapters 4.2–4.5). The plan
// (environment, arguments, lines) is pure; running, signals and the outcome file are at the edge.
import { parseOutcome } from '../core/schema/index.ts';
import { PACKAGE_NAME } from '../core/types/index.ts';
import type { CliIssue, Issue, Outcome, Result } from '../core/types/index.ts';
import {
  MODE_ENV_NAMES,
  checkStateFileName,
  generateRunId,
  writeModeState,
} from '../mode/index.ts';
import { resolveExitCode } from './exit.ts';
import type { ExitInput } from './exit.ts';
import type { ChildProcessLike, CliHost, ForwardedSignal } from './host.ts';
import { formatIssues, infoLine, outputStyle, resultLines } from './output.ts';
import type { ParsedCommand } from './parse.ts';
import { playwrightConfigArg } from '../mode/playwright-args.ts';
import { withPerfReporterArg } from './reporter-arg.ts';

export type RunCommand = Extract<ParsedCommand, { kind: 'run' }>;

/** A second SIGINT within this time kills Playwright (04-REQ-16). */
export const FORCE_KILL_WINDOW_MS = 5 * 1000;

export interface RunPlan {
  /** Arguments after `playwright test`. */
  args: string[];
  /** Environment of the Playwright process. */
  env: Record<string, string>;
  /** Lines printed before the run (04-REQ-20). */
  lines: string[];
  warnings: Issue[];
}

export interface PlanInput {
  env: Readonly<Record<string, string | undefined>>;
  runId: string;
  outcomeFile: string;
  reporterPath: string;
}

/** Outcome file path: `<tmpdir>/<pkg>-<runId>.outcome.json` (04-REQ-11). */
export function outcomeFilePath(
  tmpdir: string,
  runId: string,
  join: (a: string, b: string) => string,
): string {
  return join(tmpdir, `${PACKAGE_NAME}-${runId}.outcome.json`);
}

/**
 * The run plan (04-REQ-09, 04-REQ-15, 04-REQ-17, 04-REQ-20): PW_PERF_* set by writeModeState
 * (variables already set are replaced, with CLI_MODE_ALREADY_SET), the package reporter on the
 * last --reporter, and the mode line with the subset tip.
 */
export function planRun(cmd: RunCommand, input: PlanInput): Result<RunPlan, CliIssue> {
  const args = withPerfReporterArg(cmd.playwrightArgs, input.reporterPath);
  if (!args.ok) return args;

  const warnings: Issue[] = [];
  const preset = MODE_ENV_NAMES.filter((name) => (input.env[name] ?? '') !== '');
  if (preset.length > 0) {
    warnings.push({
      code: 'CLI_MODE_ALREADY_SET',
      message: `${preset.join(', ')} ${preset.length === 1 ? 'is' : 'are'} already set in the environment; the CLI replaces ${preset.length === 1 ? 'it' : 'them'} for this run.`,
      hint: 'Run your test command with the PW_PERF_* variables instead of the pw-perf runner.',
    });
  }
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.env)) {
    if (value !== undefined && !MODE_ENV_NAMES.includes(name)) env[name] = value;
  }
  Object.assign(
    env,
    writeModeState({
      mode: cmd.mode,
      ...(cmd.passes === undefined ? {} : { passes: cmd.passes }),
      ...(cmd.maxTests === undefined ? {} : { maxTests: cmd.maxTests }),
      ...(cmd.env === undefined ? {} : { env: cmd.env }),
      runId: input.runId,
      outcomeFile: input.outcomeFile,
      prune: cmd.prune,
    }),
  );

  // The CLI prints nothing before the run: the start banner of the reporter shows the mode, the
  // tests × passes, the estimate and the subset tip (04-REQ-20, 04-REQ-65).
  const lines: string[] = [];
  return { ok: true, value: { args: args.value, env, lines, warnings } };
}

/** "1.57.0" ≥ "1.57.0"; pre-release parts are ignored. */
export function versionAtLeast(version: string, minimum: string): boolean {
  const parts = (v: string): number[] =>
    v
      .split(/[.+-]/u)
      .slice(0, 3)
      .map((p) => Number.parseInt(p, 10) || 0);
  const a = parts(version);
  const b = parts(minimum);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

function style(host: CliHost): { color: boolean } {
  return outputStyle(host.stderr, host.env);
}

/** Directory @playwright/test is resolved from: the -c directory, else cwd (04-REQ-13, 04-D-15). */
async function playwrightDir(cmd: RunCommand, host: CliHost): Promise<string> {
  const config = playwrightConfigArg(cmd.playwrightArgs);
  if (config === null) return host.cwd;
  const path = host.paths.resolve(host.cwd, config);
  return (await host.isDirectory(path)) ? path : host.paths.dirname(path);
}

async function readOutcome(
  host: CliHost,
  file: string,
  runId: string,
): Promise<ExitInput['outcome']> {
  let text: string | null;
  try {
    text = await host.readText(file);
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (text === null) return { ok: false, reason: 'missing' };
  const parsed = parseOutcome(text, file);
  if (!parsed.ok) {
    return { ok: false, reason: 'invalid', detail: parsed.issues.map((i) => i.message).join('; ') };
  }
  if (parsed.value.runId !== runId) {
    return {
      ok: false,
      reason: 'invalid',
      detail: `it belongs to run ${parsed.value.runId}, not to this run (${runId})`,
    };
  }
  return { ok: true, value: parsed.value };
}

/**
 * Waits for the child; SIGINT and SIGTERM received by the CLI are forwarded, a second SIGINT
 * within 5 s kills it, and the CLI never exits before it (04-REQ-16).
 */
function waitForChild(
  child: ChildProcessLike,
  host: CliHost,
  received: { signal?: ForwardedSignal },
): Promise<{ code: number | null; error?: Error }> {
  return new Promise((resolve) => {
    let lastSigint: number | null = null;
    const forward = (signal: ForwardedSignal): void => {
      received.signal ??= signal;
      if (signal === 'SIGINT') {
        const now = host.now().getTime();
        if (lastSigint !== null && now - lastSigint <= FORCE_KILL_WINDOW_MS) {
          child.kill('SIGKILL');
          return;
        }
        lastSigint = now;
      }
      // Windows has no signals: kill() ends the process.
      if (host.platform === 'win32') child.kill();
      else child.kill(signal);
    };
    const off = [
      host.onSignal('SIGINT', () => forward('SIGINT')),
      host.onSignal('SIGTERM', () => forward('SIGTERM')),
    ];
    let finished = false;
    const done = (result: { code: number | null; error?: Error }): void => {
      if (finished) return;
      finished = true;
      for (const remove of off) remove();
      resolve(result);
    };
    child.once('error', (error) => done({ code: null, error }));
    child.once('exit', (code) => done({ code }));
  });
}

/** Runs `playwright test` in perf mode and returns the exit code of the CLI (04-REQ-22). */
export async function runTests(cmd: RunCommand, host: CliHost): Promise<number> {
  const out = style(host);
  const fail = (issues: Issue[]): number => {
    host.stderr.write(formatIssues(issues, 'error', out));
    return 3;
  };

  const install = host.resolvePlaywright(await playwrightDir(cmd, host));
  if (install === null) {
    return fail([
      {
        code: 'CLI_PLAYWRIGHT_NOT_FOUND',
        message: '@playwright/test is not installed in this project.',
        hint: 'Install it with "npm i -D @playwright/test", or run the command from the project directory (or pass -c <playwright.config>).',
      },
    ]);
  }
  const warnings: Issue[] = [];
  if (!versionAtLeast(install.version, host.minPlaywrightVersion)) {
    warnings.push({
      code: 'CLI_PLAYWRIGHT_UNSUPPORTED_VERSION',
      message: `@playwright/test ${install.version} is older than ${host.minPlaywrightVersion}, the lowest supported version; the run continues.`,
      hint: `Update @playwright/test to ${host.minPlaywrightVersion} or newer.`,
    });
  }

  const runId = generateRunId(host.now(), () => host.random());
  const outcomeFile = outcomeFilePath(host.tmpdir, runId, host.paths.join);
  const plan = planRun(cmd, { env: host.env, runId, outcomeFile, reporterPath: host.reporterPath });
  if (!plan.ok) return fail(plan.issues);
  warnings.push(...plan.value.warnings);
  host.stderr.write(formatIssues(warnings, 'warning', out));
  for (const line of plan.value.lines) host.stderr.write(infoLine(line));

  const received: { signal?: ForwardedSignal } = {};
  let child: ChildProcessLike;
  try {
    child = host.spawnNode([install.cliPath, 'test', ...plan.value.args], {
      cwd: host.cwd,
      env: plan.value.env,
      stdio: 'inherit',
      shell: false,
    });
  } catch (error) {
    return fail([spawnFailed(error)]);
  }
  const exit = await waitForChild(child, host, received);
  // The outcome file is removed after reading, also after a signal (04-REQ-11).
  const outcome = await readOutcome(host, outcomeFile, runId);
  await host.removeFile(outcomeFile).catch(() => undefined);
  // The state file of a check (04-REQ-49); the reporter removes it too.
  if (cmd.mode === 'check') {
    await host
      .removeFile(host.paths.join(host.tmpdir, checkStateFileName(runId)))
      .catch(() => undefined);
  }
  if (exit.error !== undefined) return fail([spawnFailed(exit.error)]);

  const resolved = resolveExitCode({
    outcome,
    childExitCode: exit.code,
    ...(received.signal === undefined ? {} : { receivedSignal: received.signal }),
    listOnly: cmd.listOnly,
  });
  host.stderr.write(formatIssues(resolved.issues, 'error', out));
  if (!cmd.listOnly) {
    const value: Outcome | null = outcome.ok ? outcome.value : null;
    host.stderr.write(resultLines(value, resolved.code, out));
  }
  return resolved.code;
}

function spawnFailed(error: unknown): Issue {
  return {
    code: 'CLI_SPAWN_FAILED',
    message: `The Playwright process could not be started: ${error instanceof Error ? error.message : String(error)}`,
    hint: 'Check that Node can run the Playwright CLI of the project (reinstall the dependencies).',
  };
}
