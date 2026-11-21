// Test scripts of the init wizard (04-REQ-54 – 04-REQ-56, 04-REQ-58; D-33, D-35): text-only
// detection of package.json scripts that run `playwright test`, the flags that break a
// measurement run, the run commands shown by the wizard and written to the CI jobs, and the
// process of the wizard's check run. Nothing is executed here and no shell is involved. Pure.
import { PACKAGE_NAME } from '../../core/types/index.ts';
import type { CliIssue, Result } from '../../core/types/index.ts';
import { scanPlaywrightArgs } from '../../mode/playwright-args.ts';
import type { PackageManager } from './detect.ts';

export interface DetectedScript {
  name: string;
  /** The script text as written in package.json. */
  text: string;
  /** Other shell operators than && (04-REQ-54 step 1): the flag analysis is approximate. */
  complex: boolean;
  /** T of the chain segment that runs Playwright (one level), else null. */
  chainTarget: string | null;
  /** Words after `playwright test` in the Playwright segment. */
  playwrightFlags: string[];
  /** Values of --project in the Playwright segment. */
  projectFlags: string[];
  /** --grep, -g, --grep-invert or test file paths select the tests (04-REQ-54). */
  selectsTests: boolean;
  /** Text of the segments after the Playwright segment (04-REQ-55, INIT_SCRIPT_LATER_STEPS). */
  laterSegments: string[];
}

interface Token {
  kind: 'word' | 'and' | 'other';
  value: string;
}

/** Shell operators other than && that make a script complex (04-REQ-54 step 1). */
const OTHER_OPERATORS = ['||', '$(', '|', ';', '&', '>', '<', '`', '\n'];

/** Words and operators of a script, like a POSIX shell without expansion (04-REQ-54 step 1). */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let word = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  const flush = (): void => {
    if (started) tokens.push({ kind: 'word', value: word });
    word = '';
    started = false;
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (quote !== null) {
      if (ch === quote) quote = null;
      else if (quote === '"' && ch === '\\' && i + 1 < text.length) {
        i += 1;
        word += text.charAt(i);
      } else word += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (text.startsWith('&&', i)) {
      flush();
      tokens.push({ kind: 'and', value: '&&' });
      i += 1;
      continue;
    }
    const op = OTHER_OPERATORS.find((o) => text.startsWith(o, i));
    if (op !== undefined) {
      flush();
      tokens.push({ kind: 'other', value: op });
      i += op.length - 1;
      continue;
    }
    if (/\s/u.test(ch)) {
      flush();
      continue;
    }
    word += ch;
    started = true;
  }
  flush();
  return tokens;
}

interface Segment {
  words: string[];
}

function segmentsOf(tokens: readonly Token[]): Segment[] {
  const segments: Segment[] = [];
  let current: string[] = [];
  for (const token of tokens) {
    if (token.kind === 'word') current.push(token.value);
    else {
      if (current.length > 0) segments.push({ words: current });
      current = [];
    }
  }
  if (current.length > 0) segments.push({ words: current });
  return segments;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;

/** Words after the environment prefix (04-REQ-54 step 2), or null when dotenv has no "--". */
function withoutPrefix(words: readonly string[]): string[] | null {
  let i = 0;
  for (;;) {
    const word = words[i];
    if (word === undefined) return [];
    if (
      ASSIGNMENT.test(word) ||
      word === 'cross-env' ||
      word === 'cross-env-shell' ||
      word === 'env'
    ) {
      i += 1;
      continue;
    }
    if (word === 'dotenv' || word === 'dotenv-cli') {
      const end = words.indexOf('--', i);
      if (end === -1) return null;
      i = end + 1;
      continue;
    }
    return words.slice(i);
  }
}

const NPX_OPTIONS = new Set(['--yes', '-y', '--no-install', '--no']);

function baseName(word: string): string {
  return word.split(/[\\/]/u).at(-1) ?? word;
}

/** Flags after `[runner] playwright test` (04-REQ-54 step 3), or null for another command. */
function directFlags(words: readonly string[]): string[] | null {
  let i = 0;
  const first = words[0];
  if (first === 'npx') {
    i = 1;
    while (NPX_OPTIONS.has(words[i] ?? '')) i += 1;
  } else if (first === 'pnpm' || first === 'yarn') {
    i = words[1] === 'exec' ? 2 : 1;
  } else if (first === 'bunx') i = 1;
  const command = words[i];
  if (command === undefined || baseName(command) !== 'playwright' || words[i + 1] !== 'test') {
    return null;
  }
  return words.slice(i + 2);
}

/** T of a chain segment (04-REQ-54 step 4), or null. */
function chainTarget(
  words: readonly string[],
  scripts: ReadonlyMap<string, string>,
): string | null {
  const [manager, sub, target] = words;
  let name: string | undefined;
  if (manager === 'npm') {
    if (sub === 'test' || sub === 't') name = 'test';
    else if (sub === 'run' || sub === 'run-script') name = target;
  } else if (manager === 'pnpm' || manager === 'yarn') {
    name = sub === 'run' ? target : sub;
  }
  return name !== undefined && scripts.has(name) ? name : null;
}

interface Analysis {
  segments: Segment[];
  complex: boolean;
}

function analyze(text: string): Analysis {
  const tokens = tokenize(text);
  return { segments: segmentsOf(tokens), complex: tokens.some((t) => t.kind === 'other') };
}

/** The direct Playwright segments of a script: index and flags. */
function directSegments(analysis: Analysis): { index: number; flags: string[] }[] {
  return analysis.segments.flatMap((segment, index) => {
    const words = withoutPrefix(segment.words);
    const flags = words === null ? null : directFlags(words);
    return flags === null ? [] : [{ index, flags }];
  });
}

const WRAPPED = new RegExp(String.raw`pw-perf|${PACKAGE_NAME}|PW_PERF_`, 'u');

/** Scripts that run `playwright test`, in package.json order (04-REQ-54). */
export function detectTestScripts(scripts: ReadonlyMap<string, string>): DetectedScript[] {
  const found: DetectedScript[] = [];
  for (const [name, text] of scripts) {
    if (WRAPPED.test(text)) continue;
    const hook = /^(?:pre|post)(.+)$/u.exec(name);
    if (hook !== null && scripts.has(hook[1] as string)) continue;
    const analysis = analyze(text);
    const playwright: { index: number; flags: string[]; target: string | null }[] = directSegments(
      analysis,
    ).map((d) => ({ ...d, target: null }));
    analysis.segments.forEach((segment, index) => {
      const words = withoutPrefix(segment.words);
      if (words === null || directFlags(words) !== null) return;
      const target = chainTarget(words, scripts);
      if (target === null || target === name) return;
      const targetText = scripts.get(target) as string;
      if (WRAPPED.test(targetText)) return;
      const inner = directSegments(analyze(targetText));
      if (inner.length === 1) {
        const rest = words.slice(words.indexOf(target) + 1).filter((w) => w !== '--');
        playwright.push({ index, flags: [...(inner[0]?.flags ?? []), ...rest], target });
      }
    });
    if (playwright.length !== 1) continue;
    const segment = playwright[0] as (typeof playwright)[number];
    if (segment.flags.includes('--list') || segment.flags.includes('--help')) continue;
    const scanned = scanPlaywrightArgs(segment.flags);
    const has = (option: string): boolean => scanned.options.some((o) => o.name === option);
    found.push({
      name,
      text,
      complex: analysis.complex,
      chainTarget: segment.target,
      playwrightFlags: segment.flags,
      projectFlags: scanned.options
        .filter((o) => o.name === '--project')
        .flatMap((o) => o.values.flatMap((v) => v.split(',')))
        .filter((v) => v !== ''),
      selectsTests: has('--grep') || has('--grep-invert') || scanned.positionals.length > 0,
      laterSegments: analysis.segments.slice(segment.index + 1).map((s) => s.words.join(' ')),
    });
  }
  return found;
}

/** The default script of step 2 (04-REQ-54): the only one, else test:e2e, e2e, test, else plain. */
export function defaultScript(found: readonly DetectedScript[]): string | null {
  if (found.length === 1) return (found[0] as DetectedScript).name;
  for (const name of ['test:e2e', 'e2e', 'test']) {
    if (found.some((s) => s.name === name)) return name;
  }
  return null;
}

/** Flags that break a measurement run (04-REQ-56), grouped by their effect. */
export type FlagEffect = 'interactive' | 'sharded' | 'reporter' | 'changingTests' | 'conditions';

const FLAG_EFFECTS: Readonly<Record<string, FlagEffect>> = {
  '--ui': 'interactive',
  '--ui-host': 'interactive',
  '--ui-port': 'interactive',
  '--debug': 'interactive',
  '--shard': 'sharded',
  '--reporter': 'reporter',
  '--last-failed': 'changingTests',
  '--only-changed': 'changingTests',
  '--workers': 'conditions',
  '--repeat-each': 'conditions',
  '--max-failures': 'conditions',
  '-x': 'conditions',
  '--global-timeout': 'conditions',
};

/** Flags of the Playwright segment that break a measurement run, in order of appearance. */
export function breakingFlags(script: DetectedScript): { flag: string; effect: FlagEffect }[] {
  const seen = new Set<string>();
  const out: { flag: string; effect: FlagEffect }[] = [];
  for (const option of scanPlaywrightArgs(script.playwrightFlags).options) {
    const effect = FLAG_EFFECTS[option.name];
    if (effect === undefined || seen.has(option.name)) continue;
    seen.add(option.name);
    out.push({ flag: option.name, effect });
  }
  return out;
}

export interface RunCommands {
  /** C: the test command, e.g. "npm run e2e:qa". */
  base: string;
  test: string;
  thresholds: string;
  check: string;
}

/** C for the script (null: plain `playwright test`) and package manager (04-REQ-55). */
export function testCommand(script: string | null, manager: PackageManager): string {
  if (script === null) {
    return manager === 'npm'
      ? 'npx playwright test'
      : manager === 'pnpm'
        ? 'pnpm exec playwright test'
        : 'yarn playwright test';
  }
  return manager === 'yarn' ? `yarn ${script}` : `${manager} run ${script}`;
}

/** The run commands of every mode (04-REQ-55): `PW_PERF_MODE=m C`, on Windows with cross-env. */
export function runCommands(
  script: string | null,
  manager: PackageManager,
  platform: string,
): RunCommands {
  const base = testCommand(script, manager);
  const prefix = platform === 'win32' ? 'npx cross-env ' : '';
  const mode = (m: string): string => `${prefix}PW_PERF_MODE=${m} ${base}`;
  return { base, test: mode('test'), thresholds: mode('thresholds'), check: mode('check') };
}

/** Characters a script name may have to run through a shell on Windows (04-REQ-58). */
const SAFE_SCRIPT = /^[A-Za-z0-9@%+=:,./_-]+$/u;
const SCRIPT_FILE = /\.[cm]?js$/iu;

export interface SpawnSpec {
  file: string;
  args: string[];
  shell: boolean;
}

/**
 * The process of the wizard's check run (04-REQ-58), without spawning: the package manager with
 * `run <script>` (through Node when npm_execpath is its JavaScript file), or for plain
 * `playwright test` the Playwright CLI through Node. An error means: show the command instead.
 */
export function commandSpawn(input: {
  script: string | null;
  packageManager: PackageManager;
  /** npm_execpath of the wizard process, if any. */
  npmExecPath?: string | undefined;
  /** process.execPath. */
  nodePath: string;
  /** The Playwright CLI script for plain `playwright test`, or null when not installed. */
  playwrightCli: string | null;
  platform: string;
}): Result<SpawnSpec, CliIssue> {
  const manual = (reason: string): Result<SpawnSpec, CliIssue> => ({
    ok: false,
    issues: [
      {
        code: 'INIT_MANUAL_STEP',
        message: reason,
        hint: `Run the check command yourself: ${runCommands(input.script, input.packageManager, input.platform).check}`,
      },
    ],
  });
  if (input.script === null) {
    if (input.playwrightCli === null) return manual('@playwright/test is not installed here');
    return {
      ok: true,
      value: { file: input.nodePath, args: [input.playwrightCli, 'test'], shell: false },
    };
  }
  const execPath = input.npmExecPath ?? '';
  const managerFile = baseName(execPath).toLowerCase();
  if (SCRIPT_FILE.test(execPath) && managerFile.startsWith(input.packageManager)) {
    return {
      ok: true,
      value: { file: input.nodePath, args: [execPath, 'run', input.script], shell: false },
    };
  }
  if (input.platform === 'win32') {
    if (!SAFE_SCRIPT.test(input.script)) {
      return manual(`the script name "${input.script}" cannot be passed to a shell safely`);
    }
    return {
      ok: true,
      value: { file: input.packageManager, args: ['run', input.script], shell: true },
    };
  }
  return {
    ok: true,
    value: { file: input.packageManager, args: ['run', input.script], shell: false },
  };
}
