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

/**
 * The command of the next pass (04-REQ-63): `<pm> run <script> [--] <added args>` when Playwright
 * runs from a package manager script that exists in the nearest package.json and names Playwright,
 * otherwise the Playwright command line itself.
 */
export function passCommand(input: {
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
}): PassCommand {
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
    return SCRIPT_FILE.test(manager)
      ? { file: input.execPath, args: [manager, 'run', event, ...tail] }
      : { file: manager, args: ['run', event, ...tail] };
  }
  return { file: input.execPath, args: input.argv.slice(1) };
}
