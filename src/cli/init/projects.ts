// Projects of the init wizard (04-REQ-57, D-33): the literal `projects` array of playwright.config
// read as text, which projects are helpers (setup/teardown), their browser hints, which look like
// API tests, and the default selection of step 3. Nothing is executed. Pure.
import { matchBracket, skipNonCode } from './scan.ts';
import type { DetectedScript } from './scripts.ts';

export type BrowserHint = 'chromium' | 'firefox' | 'webkit';

export interface LiteralProject {
  name: string;
  helper: boolean;
  browserHint: BrowserHint | null;
  looksLikeApi: boolean;
}

interface RawProject {
  name: string;
  dependencies: string[];
  teardown: string | null;
  testMatch: string;
  testDir: string;
  browserHint: BrowserHint | null;
}

const STRING = String.raw`(['"\x60])([^'"\x60\n]*)\1`;

function firstString(text: string, key: string): string | null {
  const m = new RegExp(String.raw`\b${key}\s*:\s*${STRING}`, 'u').exec(text);
  return m === null ? null : (m[2] as string);
}

function browserHintOf(text: string): BrowserHint | null {
  const browser = firstString(text, 'browserName');
  if (browser === 'chromium' || browser === 'firefox' || browser === 'webkit') return browser;
  const channel = firstString(text, 'channel');
  if (channel !== null && /^(?:chrome|msedge|chromium)/u.test(channel)) return 'chromium';
  const device = new RegExp(String.raw`\bdevices\s*\[\s*${STRING}\s*\]`, 'u').exec(text);
  if (device !== null) {
    const name = (device[2] as string).toLowerCase();
    if (name.includes('firefox')) return 'firefox';
    if (
      name.includes('safari') ||
      name.includes('webkit') ||
      name.includes('iphone') ||
      name.includes('ipad')
    )
      return 'webkit';
    return 'chromium';
  }
  return null;
}

/** Top-level elements of an array literal `[ ... ]` (text between `open` and `close`). */
function elements(text: string, open: number, close: number): string[] | null {
  const out: string[] = [];
  let i = open + 1;
  let previous = '[';
  while (i < close - 1) {
    const skipped = skipNonCode(text, i, previous);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    const c = text[i] as string;
    if (/[\s,]/u.test(c)) {
      i += 1;
      continue;
    }
    if (c !== '{') return null;
    const end = matchBracket(text, i);
    if (end === -1) return null;
    out.push(text.slice(i, end));
    previous = '}';
    i = end;
  }
  return out;
}

/** Text of the object without its nested objects, so `name` of `use: {...}` is not taken. */
function ownLevel(object: string): string {
  let out = '';
  let depth = 0;
  for (const c of object) {
    if (c === '{' || c === '[') depth += 1;
    if (depth <= 1 || c === '[' || c === ']') out += c;
    if (c === '}' || c === ']') depth -= 1;
  }
  return out;
}

function rawProjects(configText: string): RawProject[] | null {
  const m = /\bprojects\s*:\s*\[/u.exec(configText);
  if (m === null) return null;
  const open = m.index + m[0].length - 1;
  const close = matchBracket(configText, open);
  if (close === -1) return null;
  const items = elements(configText, open, close);
  if (items === null || items.length === 0) return null;
  const projects: RawProject[] = [];
  for (const item of items) {
    const own = ownLevel(item);
    const name = firstString(own, 'name');
    if (name === null || /\.\.\./u.test(own)) return null;
    const deps = /\bdependencies\s*:\s*\[([^\]]*)\]/u.exec(item);
    projects.push({
      name,
      dependencies:
        deps === null
          ? []
          : [...(deps[1] as string).matchAll(new RegExp(STRING, 'gu'))].map((d) => d[2] as string),
      teardown: firstString(item, 'teardown'),
      testMatch: /\btestMatch\s*:\s*([^,\n}]+)/u.exec(item)?.[1] ?? '',
      testDir: firstString(item, 'testDir') ?? '',
      browserHint: browserHintOf(item),
    });
  }
  return projects;
}

/** The literal projects (04-REQ-57), or null when the array cannot be read as text. */
export function literalProjects(configText: string): LiteralProject[] | null {
  const raw = rawProjects(configText);
  if (raw === null) return null;
  const referenced = new Set(
    raw.flatMap((p) => [...p.dependencies, ...(p.teardown === null ? [] : [p.teardown])]),
  );
  return raw.map((p) => ({
    name: p.name,
    helper: referenced.has(p.name) || /setup|teardown/iu.test(p.testMatch),
    browserHint: p.browserHint,
    looksLikeApi: /api/iu.test(`${p.name} ${p.testDir} ${p.testMatch}`),
  }));
}

/** `*` in a --project value matches any characters, like Playwright. */
function matchesProject(pattern: string, name: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`, 'iu').test(name);
}

/** Projects named by the script's --project flags. */
export function scriptProjects(
  projects: readonly LiteralProject[],
  script: DetectedScript | null,
): string[] {
  const flags = script?.projectFlags ?? [];
  return projects.filter((p) => flags.some((f) => matchesProject(f, p.name))).map((p) => p.name);
}

/** The default selection of step 3 (04-REQ-57). */
export function defaultProjects(
  projects: readonly LiteralProject[],
  script: DetectedScript | null,
): string[] {
  const named = scriptProjects(projects, script);
  if (named.length > 0) return named;
  return projects
    .filter((p) => !p.helper && (p.browserHint ?? 'chromium') === 'chromium' && !p.looksLikeApi)
    .map((p) => p.name);
}
