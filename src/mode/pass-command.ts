// Command of the next pass (04-REQ-63, D-39): the same test command again, built from the
// Playwright process. Pure: the caller passes process.execPath, process.argv and the environment.
import { testArgsFromArgv } from './playwright-args.ts';

export interface PassCommand {
  file: string;
  args: string[];
}

/** A package manager that is a JavaScript file runs through Node (npm-cli.js, pnpm.cjs, yarn.js). */
const SCRIPT_FILE = /\.[cm]?js$/iu;

/** Last path segment, for both separators. */
function baseName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

/**
 * Words of a shell text, split on blanks; quotes are removed but keep their content together.
 * Good enough for the Playwright segment of a script (04-REQ-63); never executed.
 */
function words(text: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: string | null = null;
  let started = false;
  for (const ch of text) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/u.test(ch)) {
      if (started) out.push(current);
      current = '';
      started = false;
    } else {
      current += ch;
      started = true;
    }
  }
  if (started) out.push(current);
  return out;
}

/**
 * Words after `playwright test` in the last segment of the script that runs it, or null when the
 * script does not run `playwright test` (then every argument of the run belongs to the script).
 */
function scriptPlaywrightArgs(script: string): string[] | null {
  const segments = script.split(/&&|\|\||;|\|/u);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const w = words(segments[i] ?? '');
    const at = w.findIndex(
      (word, j) =>
        (baseName(word) === 'playwright' || word === 'playwright') && w[j + 1] === 'test',
    );
    if (at >= 0) return w.slice(at + 2);
  }
  return null;
}

/**
 * Arguments the user added to the script (`npm run e2e -- --grep b`): the Playwright arguments
 * beyond the words of the script's `playwright test` segment (04-REQ-63).
 */
function addedArgs(argv: readonly string[], script: string | undefined): string[] {
  if (script === undefined) return [];
  const own = scriptPlaywrightArgs(script);
  if (own === null) return [];
  const args = testArgsFromArgv(argv);
  const prefix = own.every((word, i) => args[i] === word);
  return args.slice(prefix ? own.length : Math.min(own.length, args.length));
}

interface PassInput {
  execPath: string;
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  /**
   * Scripts of the nearest package.json, or null/undefined when it cannot be read. The text of the
   * script as written, because pnpm puts the added arguments into npm_lifecycle_script. Only a
   * script of this name runs again: `npx playwright test` sets npm_lifecycle_event to `npx`, which
   * is no script. npm_lifecycle_script is the fallback only without a readable package.json.
   */
  scripts?: Readonly<Record<string, string>> | null;
}

/**
 * How the run was started (04-REQ-63): from a package manager script that names Playwright
 * (`script` with the words after the script name, `--` first for npm), or not (`script: null`
 * with the Playwright arguments).
 */
export interface RunShape {
  script: { event: string; manager: string } | null;
  /** Words the user added after the command. */
  tail: string[];
}

export function runShape(input: PassInput): RunShape {
  const event = input.env['npm_lifecycle_event'];
  const manager = input.env['npm_execpath'];
  const scripts = input.scripts ?? null;
  const script =
    event === undefined
      ? ''
      : scripts === null
        ? (input.env['npm_lifecycle_script'] ?? '')
        : Object.hasOwn(scripts, event)
          ? (scripts[event] ?? '')
          : '';
  // Only a script that names Playwright: the npm_* variables of an outer script (e.g. a test
  // runner that starts Playwright itself) must not run that outer script again.
  if (
    event !== undefined &&
    event !== '' &&
    manager !== undefined &&
    manager !== '' &&
    /playwright/u.test(script)
  ) {
    const added = addedArgs(input.argv, script);
    const npm = baseName(manager).toLowerCase().startsWith('npm');
    const tail = added.length === 0 ? [] : npm ? ['--', ...added] : added;
    return { script: { event, manager }, tail };
  }
  return { script: null, tail: testArgsFromArgv(input.argv) };
}

/**
 * The command of the next pass (04-REQ-63): `<pm> run <script> [--] <added args>` when Playwright
 * runs from a package manager script that exists in the nearest package.json and names Playwright,
 * otherwise the Playwright command line itself.
 */
export function passCommand(input: PassInput): PassCommand {
  const shape = runShape(input);
  if (shape.script !== null) {
    const { event, manager } = shape.script;
    return SCRIPT_FILE.test(manager)
      ? { file: input.execPath, args: [manager, 'run', event, ...shape.tail] }
      : { file: manager, args: ['run', event, ...shape.tail] };
  }
  return { file: input.execPath, args: input.argv.slice(1) };
}

/** One row of the process table: `ps -A -o pid=,ppid=,args=` (04-REQ-63 point 2). */
export interface ProcessRow {
  pid: number;
  ppid: number;
  args: string;
}

/** Rows of `ps -A -o pid=,ppid=,args=` output; lines that do not parse are left out. */
export function parseProcessTable(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line);
    if (match === null) continue;
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), args: match[3] ?? '' });
  }
  return rows;
}

/** A package manager file: npm, pnpm, yarn or bun, with or without a JS extension; npm-cli.js. */
const MANAGER = /^(npm|pnpm|yarn|bun)(-cli)?(\.[cm]?js)?$/iu;
/** Ancestors looked at above the Playwright process (04-REQ-63 point 2). */
const MAX_DEPTH = 16;

/** The script an ancestor runs (`[node] <pm> [options] run|run-script <name>`), or null. */
function runScriptName(args: string): string | null {
  const w = args.split(/\s+/u).filter((word) => word !== '');
  let i = 0;
  if (!MANAGER.test(baseName(w[0] ?? ''))) {
    // `node /…/bin/npm run x`: the manager is the second word.
    if (!/^node(\.exe)?$/iu.test(baseName(w[0] ?? ''))) return null;
    i = 1;
    if (!MANAGER.test(baseName(w[1] ?? ''))) return null;
  }
  i += 1;
  while ((w[i] ?? '').startsWith('-')) i += 1;
  if (w[i] !== 'run' && w[i] !== 'run-script') return null;
  return w[i + 1] ?? null;
}

/**
 * Name of the package script that started Playwright through `npx`/`pnpm exec`/`yarn dlx`
 * (04-REQ-63 point 2, 04-D-57): the nearest ancestor of `pid` that runs a script of `scripts`
 * naming Playwright, or null. `npx` overwrites npm_lifecycle_event, so only the process table
 * still knows the outer script.
 */
export function ancestorScript(input: {
  rows: readonly ProcessRow[];
  pid: number;
  scripts: Readonly<Record<string, string>>;
}): string | null {
  const byPid = new Map(input.rows.map((row) => [row.pid, row]));
  let current = byPid.get(input.pid)?.ppid;
  for (let depth = 0; depth < MAX_DEPTH && current !== undefined && current > 0; depth += 1) {
    const row = byPid.get(current);
    if (row === undefined) return null;
    const name = runScriptName(row.args);
    if (
      name !== null &&
      Object.hasOwn(input.scripts, name) &&
      /playwright/u.test(input.scripts[name] ?? '')
    ) {
      return name;
    }
    if (row.ppid === row.pid) return null;
    current = row.ppid;
  }
  return null;
}

/**
 * The environment as the next pass sees the run (04-REQ-63): when Playwright runs through an
 * exec command inside a script, npm_lifecycle_event becomes the script of the nearest ancestor
 * (point 2). `processTable` is called only then, so other runs start no process.
 */
export function scriptEnv(input: {
  env: Readonly<Record<string, string | undefined>>;
  scripts: Readonly<Record<string, string>> | null | undefined;
  pid: number | undefined;
  processTable: (() => string | null) | undefined;
}): Readonly<Record<string, string | undefined>> {
  const { env, scripts } = input;
  const event = env['npm_lifecycle_event'];
  const manager = env['npm_execpath'];
  if (
    event === undefined ||
    event === '' ||
    manager === undefined ||
    manager === '' ||
    scripts === null ||
    scripts === undefined ||
    Object.hasOwn(scripts, event) ||
    input.pid === undefined ||
    input.processTable === undefined
  ) {
    return env;
  }
  const text = input.processTable();
  if (text === null) return env;
  const name = ancestorScript({ rows: parseProcessTable(text), pid: input.pid, scripts });
  if (name === null) return env;
  return { ...env, npm_lifecycle_event: name, npm_lifecycle_script: scripts[name] ?? '' };
}
