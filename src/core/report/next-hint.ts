// The `Next:` hint after a run (09-REQ-32) and the commands it names (D-35, 04-REQ-55). Pure:
// the reporter reads the environment and the files and passes them in.
import type { RunReport } from '../types/index.ts';

export type PerfMode = 'test' | 'thresholds' | 'check';
export type PackageManager = 'npm' | 'pnpm' | 'yarn';

/** `PW_PERF_MODE=<mode>[ PW_PERF_ENV=<env>] C`, with `npx cross-env` on win32 (04-REQ-55). */
export function perfCommand(
  mode: PerfMode,
  env: string | null,
  command: string,
  platform: string,
): string {
  const vars = `PW_PERF_MODE=${mode}${env === null ? '' : ` PW_PERF_ENV=${env}`}`;
  return `${platform === 'win32' ? 'npx cross-env ' : ''}${vars} ${command}`;
}

/** `npm run S`, `pnpm run S` or `yarn S` (04-REQ-55). */
export function scriptCommand(pm: PackageManager, script: string): string {
  return pm === 'yarn' ? `yarn ${script}` : `${pm} run ${script}`;
}

/** `npx playwright test`, `pnpm exec playwright test` or `yarn playwright test`. */
export function plainCommand(pm: PackageManager): string {
  return pm === 'pnpm'
    ? 'pnpm exec playwright test'
    : pm === 'yarn'
      ? 'yarn playwright test'
      : 'npx playwright test';
}

/** A word as typed in a shell: quoted when it has blanks or shell characters (display only). */
export function shellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/u.test(word) ? word : `'${word.replace(/'/gu, `'\\''`)}'`;
}

/**
 * The test command as the user types it (04-REQ-64, 04-D-51): `npm run <script>` (pnpm, yarn) or
 * `npx playwright test` (…), then the words the user added; no absolute paths.
 */
export function userCommand(
  pm: PackageManager,
  script: string | null,
  tail: readonly string[],
): string {
  const head = script === null ? plainCommand(pm) : scriptCommand(pm, script);
  return [head, ...tail.map(shellWord)].join(' ');
}

export interface CommandContext {
  /** Environment label of the run. */
  env: string | null;
  /** npm_lifecycle_event and npm_lifecycle_script (npm, pnpm and yarn set them in scripts). */
  lifecycleEvent: string | null;
  lifecycleScript: string | null;
  /** npm_config_user_agent, e.g. "pnpm/9.0.0 npm/? node/v22". */
  userAgent: string | null;
  /** Lock files next to the nearest package.json. */
  lockFiles: { pnpm: boolean; yarn: boolean };
  /** `scripts` of the nearest package.json, or null. */
  scripts: Readonly<Record<string, string>> | null;
  platform: string;
}

/** Package manager from the user agent, else from the lock file, default npm. */
export function packageManager(
  ctx: Pick<CommandContext, 'userAgent' | 'lockFiles'>,
): PackageManager {
  const agent = ctx.userAgent ?? '';
  if (agent.startsWith('pnpm/')) return 'pnpm';
  if (agent.startsWith('yarn/')) return 'yarn';
  if (agent.startsWith('npm/')) return 'npm';
  if (ctx.lockFiles.pnpm) return 'pnpm';
  if (ctx.lockFiles.yarn) return 'yarn';
  return 'npm';
}

/** The script sets the mode itself or calls the pw-perf runner (09-REQ-32, case 3). */
function setsMode(script: string): boolean {
  return (
    /\bPW_PERF_MODE=/u.test(script) ||
    /\bpw-perf\b/u.test(script) ||
    /\bplaywright-performance-regression\b/u.test(script)
  );
}

/** A script of the project that runs `mode` (for `env`), as in 09-REQ-32 case 3. */
function modeScript(
  scripts: Readonly<Record<string, string>>,
  mode: PerfMode,
  env: string | null,
): string | null {
  if (env !== null && Object.hasOwn(scripts, `perf:${mode}:${env}`)) return `perf:${mode}:${env}`;
  if (Object.hasOwn(scripts, `perf:${mode}`)) return `perf:${mode}`;
  const runs = (text: string): boolean =>
    text.includes(`PW_PERF_MODE=${mode}`) ||
    new RegExp(`\\b(?:pw-perf|playwright-performance-regression) ${mode}\\b`, 'u').test(text);
  const hasEnv = (text: string): boolean =>
    env === null || text.includes(`PW_PERF_ENV=${env}`) || text.includes(`--env ${env}`);
  for (const [name, text] of Object.entries(scripts)) {
    if (runs(text) && hasEnv(text)) return name;
  }
  return null;
}

/**
 * The project's command for `mode` (09-REQ-32), always with the variable (04-REQ-70): the same
 * package script with the variable, a script that sets the mode itself, or plain
 * `playwright test` with the variable.
 */
export function suggestCommand(mode: PerfMode, ctx: CommandContext): string {
  const pm = packageManager(ctx);
  const event = ctx.lifecycleEvent;
  // `npx playwright test` sets npm_lifecycle_event to `npx`: only a script of the project counts
  // (04-REQ-63); without a readable package.json the event is trusted.
  const isScript =
    event !== null && event !== '' && (ctx.scripts === null || Object.hasOwn(ctx.scripts, event));
  if (event !== null && isScript) {
    const script = ctx.lifecycleScript ?? '';
    if (!setsMode(script)) {
      return perfCommand(mode, ctx.env, scriptCommand(pm, event), ctx.platform);
    }
    const own = ctx.scripts === null ? null : modeScript(ctx.scripts, mode, ctx.env);
    if (own !== null) return scriptCommand(pm, own);
    return perfCommand(mode, ctx.env, scriptCommand(pm, event), ctx.platform);
  }
  return perfCommand(mode, ctx.env, plainCommand(pm), ctx.platform);
}

export interface WrittenFile {
  /** File name as shown, e.g. pw-perf-thresholds.json. */
  name: string;
  entries: number;
}

export interface NextHintInput {
  report: Pick<
    RunReport,
    'mode' | 'toolErrors' | 'warnings' | 'endpoints' | 'steps' | 'ci' | 'evaluation'
  >;
  commands: Record<PerfMode, string>;
  /** Thresholds files written in this run (thresholds mode). */
  written: readonly WrittenFile[];
  /** The thresholds files are temporary: the wizard's check (04-REQ-58, 09-REQ-32 row 5). */
  temporary?: boolean;
}

/** Text after `Next: `, or null when there is no hint (09-REQ-32, rows 1–8). */
export function nextHint(input: NextHintInput): string | null {
  const { report, commands, written } = input;
  if (report.toolErrors.length > 0) return null;
  const measured = Object.keys(report.endpoints).length > 0 || Object.keys(report.steps).length > 0;
  if (!measured) {
    return `nothing was measured: check use.baseURL and the projects of the test command, then run ${commands.check}`;
  }
  if (report.mode === 'thresholds') {
    if (written.length === 0 || input.temporary === true) return null;
    const files = written
      .map((f) => `${f.name} (${String(f.entries)} ${f.entries === 1 ? 'key' : 'keys'})`)
      .join(' and ');
    const local =
      report.ci === null ? '; for CI, derive them on the CI machines (docs/thresholds.md)' : '';
    return `commit ${files}${local}`;
  }
  if (report.warnings.some((w) => w.code === 'THRESHOLDS_FILE_MISSING')) {
    return `derive thresholds: ${commands.thresholds}`;
  }
  if (report.evaluation.status === 'failed') {
    return `open the report; if the slowdown is intended, derive thresholds again: ${commands.thresholds}`;
  }
  return null;
}
