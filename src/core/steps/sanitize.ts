// Sanitization of step titles (06, chapter 5.2): cleanup, privacy, key stability and length,
// in this order (06-REQ-24). Pure and deterministic; every expression is a package constant
// (P-13). Text already replaced by a placeholder is never matched again.
import type { ResolvedConfig } from '../config/index.ts';
import { ID_PATTERNS, compileIdMatcher } from '../normalize/patterns.ts';
import type { IdMatcher } from '../normalize/patterns.ts';

export type RedactionRule = 'url' | 'jwt' | 'auth-scheme' | 'secret-pair';

export interface SanitizeOptions {
  normalizeTitles: boolean;
  redactQuotedValues: boolean;
  idPatterns: ResolvedConfig['keys']['idPatterns'];
  extraIdPatterns: ResolvedConfig['keys']['extraIdPatterns'];
}

export interface SanitizedTitle {
  text: string;
  /** Privacy rules P1–P4 that fired, in rule order (06-REQ-38). */
  redacted: RedactionRule[];
}

/** Title of a step whose cleaned title is empty (06-REQ-33). */
export const UNTITLED = '(untitled)';
/** Longest segment in code points before truncation (06-REQ-36). */
export const MAX_SEGMENT_LENGTH = 200;

/** Characters cut from both ends of a word to get its core (06-REQ-34). */
const EDGE = new Set([...'"\'`()[]{}<>#,.;:!?']);
/** Characters after a URL that are not part of it (06-REQ-34, P1). */
const URL_TRAILING = /[.,;:!?)\]}]+$/u;

const URL_RE = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'`<>]+|www\.[^\s"'`<>]+/giu;
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/gu;
const AUTH_SCHEMES = new Set(['bearer', 'basic', 'token']);
const SECRET_NAMES = [
  'authorization',
  'access_key',
  'api_key',
  'api-key',
  'apikey',
  'password',
  'session',
  'passwd',
  'secret',
  'cookie',
  'token',
  'auth',
  'pass',
  'otp',
  'pin',
  'pwd',
  'sid',
];
const SECRET_PAIR_RE = new RegExp(
  `(?<=^|[\\s_-])(?:${SECRET_NAMES.join('|')})\\s*[=:]\\s*(\\S+)`,
  'giu',
);
const EMAIL_RE = /[^\s@"'`<>()[\]]+@[^\s@"'`<>()[\]]+\.[A-Za-z]{2,}/gu;
const PHONE_RE = /\+[0-9][0-9 ().-]{6,}[0-9]/gu;
const IPV4_RE = /^[0-9]{1,3}(?:\.[0-9]{1,3}){3}$/u;
const LONG_DIGITS_RE = /^[0-9]{9,}$/u;
const TEMPLATE_RE = /\$\{[^}]*\}|\{\{[^}]*\}\}/gu;

const DATETIME_RE =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?(?:Z|[+-][0-9]{2}:?[0-9]{2})?$/u;
const DATE_RES = [
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u,
  /^[0-9]{4}\/[0-9]{2}\/[0-9]{2}$/u,
  /^[0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}$/u,
];
const TIME_RE = /^[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?$/u;
const MERIDIEM_RE = /^(?:AM|PM)$/iu;
const NUMBER_RES = [
  /^[+-]?[0-9]+(?:[.,][0-9]+)+[A-Za-zµ%°]{0,4}$/u,
  /^[+-]?[0-9]+[A-Za-zµ%°]{1,4}$/u,
];

/** Quote pairs of rule K2: opening → closing (06-REQ-35). */
const QUOTES: ReadonlyMap<string, string> = new Map([
  ['"', '"'],
  ["'", "'"],
  ['`', '`'],
  ['“', '”'],
  ['„', '”'],
  ['‘', '’'],
  ['«', '»'],
]);
const QUOTE_OPEN_AFTER = new Set([' ', '(', '[', '{', ':', '=']);
const QUOTE_CLOSE_BEFORE = new Set([' ', '.', ',', ';', ':', '!', '?', ')', ']', '}']);

/**
 * A segment with a protection mask: one flag per UTF-16 code unit, true for placeholder text
 * that later rules must not match.
 */
class Masked {
  text: string;
  mask: boolean[];

  constructor(text: string) {
    this.text = text;
    this.mask = Array.from({ length: text.length }, () => false);
  }

  /** True when any code unit in [start, end) is protected. */
  protectedIn(start: number, end: number): boolean {
    for (let i = start; i < end; i++) if (this.mask[i] === true) return true;
    return false;
  }

  /** Applies replacements, given in any order and not overlapping. */
  apply(replacements: Replacement[]): void {
    for (const r of [...replacements].sort((a, b) => b.start - a.start)) {
      this.text = this.text.slice(0, r.start) + r.text + this.text.slice(r.end);
      const flags = Array.from({ length: r.text.length }, () => r.protect);
      this.mask.splice(r.start, r.end - r.start, ...flags);
    }
  }

  /** Maximal runs of unprotected code units. */
  freeRuns(): { start: number; text: string }[] {
    const runs: { start: number; text: string }[] = [];
    let start = -1;
    for (let i = 0; i <= this.text.length; i++) {
      const free = i < this.text.length && this.mask[i] !== true;
      if (free && start < 0) start = i;
      if (!free && start >= 0) {
        runs.push({ start, text: this.text.slice(start, i) });
        start = -1;
      }
    }
    return runs;
  }

  /** Words (maximal runs of non-space characters) with their cores (06-REQ-34). */
  words(): Word[] {
    const result: Word[] = [];
    const re = /[^ ]+/gu;
    for (const match of this.text.matchAll(re)) {
      const start = match.index;
      const end = start + match[0].length;
      let coreStart = start;
      let coreEnd = end;
      while (coreStart < coreEnd && EDGE.has(this.text[coreStart] ?? '')) coreStart++;
      while (coreEnd > coreStart && EDGE.has(this.text[coreEnd - 1] ?? '')) coreEnd--;
      result.push({ start, end, coreStart, coreEnd });
    }
    return result;
  }
}

interface Replacement {
  start: number;
  end: number;
  text: string;
  protect: boolean;
}

interface Word {
  start: number;
  end: number;
  coreStart: number;
  coreEnd: number;
}

/** Replaces every match of `re` in unprotected text; `pick` narrows a match or rejects it. */
function replaceMatches(
  s: Masked,
  re: RegExp,
  placeholder: string,
  pick: (match: RegExpMatchArray) => { from: number; to: number } | null = (m) => ({
    from: 0,
    to: m[0].length,
  }),
): number {
  const replacements: Replacement[] = [];
  for (const run of s.freeRuns()) {
    for (const match of run.text.matchAll(re)) {
      const span = pick(match);
      if (span === null || span.to <= span.from) continue;
      const start = run.start + match.index + span.from;
      replacements.push({
        start,
        end: run.start + match.index + span.to,
        text: placeholder,
        protect: true,
      });
    }
  }
  s.apply(replacements);
  return replacements.length;
}

/** Replaces the core of every unprotected word for which `test` returns a placeholder. */
function replaceCores(s: Masked, test: (core: string) => string | null): number {
  const replacements: Replacement[] = [];
  for (const word of s.words()) {
    if (word.coreEnd <= word.coreStart || s.protectedIn(word.coreStart, word.coreEnd)) continue;
    const placeholder = test(s.text.slice(word.coreStart, word.coreEnd));
    if (placeholder === null) continue;
    replacements.push({
      start: word.coreStart,
      end: word.coreEnd,
      text: placeholder,
      protect: true,
    });
  }
  s.apply(replacements);
  return replacements.length;
}

/** Stage 1, cleanup (06-REQ-33). Returns null for an empty title. */
function cleanup(title: string): string | null {
  const text = title
    .normalize('NFC')
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}\p{White_Space}]+/gu, ' ')
    .trim()
    .replace(/[›»]/gu, '>');
  return text === '' ? null : text;
}

/** Stage 2, privacy (06-REQ-34): rules P1–P9, always on. */
function privacy(s: Masked): RedactionRule[] {
  const fired: RedactionRule[] = [];
  // P1: URL, trailing punctuation stays outside.
  const urls = replaceMatches(s, URL_RE, ':url', (m) => {
    const trailing = URL_TRAILING.exec(m[0]);
    return { from: 0, to: m[0].length - (trailing?.[0].length ?? 0) };
  });
  if (urls > 0) fired.push('url');
  // P2: JWT.
  if (replaceMatches(s, JWT_RE, ':secret') > 0) fired.push('jwt');
  // P3: authentication scheme and the next word.
  {
    const words = s.words();
    const replacements: Replacement[] = [];
    for (let i = 0; i + 1 < words.length; i++) {
      const word = words[i];
      const next = words[i + 1];
      if (word === undefined || next === undefined) continue;
      if (s.protectedIn(word.coreStart, word.coreEnd)) continue;
      const core = s.text.slice(word.coreStart, word.coreEnd).toLowerCase();
      if (!AUTH_SCHEMES.has(core) || s.protectedIn(next.start, next.end)) continue;
      replacements.push({ start: next.start, end: next.end, text: ':secret', protect: true });
      i++;
    }
    s.apply(replacements);
    if (replacements.length > 0) fired.push('auth-scheme');
  }
  // P4: name–secret pair; the name and the separator stay.
  const pairs = replaceMatches(s, SECRET_PAIR_RE, ':secret', (m) => {
    const value = m[1] ?? '';
    return { from: m[0].length - value.length, to: m[0].length };
  });
  if (pairs > 0) fired.push('secret-pair');
  // P5, P6: e-mail and phone number.
  replaceMatches(s, EMAIL_RE, ':email');
  replaceMatches(s, PHONE_RE, ':phone');
  // P7: IPv4.
  replaceCores(s, (core) => (IPV4_RE.test(core) ? ':ip' : null));
  // P8: query and fragment of a path.
  {
    const replacements: Replacement[] = [];
    for (const word of s.words()) {
      const core = s.text.slice(word.coreStart, word.coreEnd);
      if (!core.startsWith('/')) continue;
      const cut = core.search(/[?#]/u);
      if (cut < 0) continue;
      const start = word.coreStart + cut;
      if (s.protectedIn(start, word.coreEnd)) continue;
      replacements.push({ start, end: word.coreEnd, text: '?:query', protect: true });
    }
    s.apply(replacements);
  }
  // P9: long ids and tokens, with the package's own patterns (06-D-22).
  replaceCores(s, (core) =>
    ID_PATTERNS.uuid.test(core) ||
    ID_PATTERNS.hex.test(core) ||
    ID_PATTERNS.token.test(core) ||
    ID_PATTERNS.mixed.test(core) ||
    LONG_DIGITS_RE.test(core)
      ? ':id'
      : null,
  );
  return fired;
}

/** Rule K2: the content of quote pairs becomes :value, the quotes stay (06-REQ-35). */
function redactQuotes(s: Masked): void {
  const text = s.text;
  const replacements: Replacement[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text[i] ?? '';
    const close = QUOTES.get(open);
    const opensHere = close !== undefined && (i === 0 || QUOTE_OPEN_AFTER.has(text[i - 1] ?? ''));
    if (!opensHere) {
      i++;
      continue;
    }
    let j = i + 1;
    let found = -1;
    while (j < text.length) {
      if (text[j] === close) {
        const after = text[j + 1];
        if (after === undefined || QUOTE_CLOSE_BEFORE.has(after)) {
          found = j;
          break;
        }
      }
      j++;
    }
    if (found > i + 1) {
      replacements.push({ start: i + 1, end: found, text: ':value', protect: true });
      i = found + 1;
    } else {
      i++;
    }
  }
  s.apply(replacements);
}

/** Rule K3: dates and times, in one core or two words (06-REQ-35). */
function replaceDates(s: Masked): void {
  const words = s.words();
  const replacements: Replacement[] = [];
  const core = (w: Word): string => s.text.slice(w.coreStart, w.coreEnd);
  const free = (w: Word): boolean =>
    w.coreEnd > w.coreStart && !s.protectedIn(w.coreStart, w.coreEnd);
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === undefined || !free(word)) continue;
    const next = words[i + 1];
    // Two words: nothing may be cut between them.
    if (
      next !== undefined &&
      free(next) &&
      word.coreEnd === word.end &&
      next.coreStart === next.start
    ) {
      const pair = `${core(word)} ${core(next)}`;
      const placeholder = DATETIME_RE.test(pair)
        ? ':datetime'
        : TIME_RE.test(core(word)) && MERIDIEM_RE.test(core(next))
          ? ':time'
          : null;
      if (placeholder !== null) {
        replacements.push({
          start: word.coreStart,
          end: next.coreEnd,
          text: placeholder,
          protect: true,
        });
        i++;
        continue;
      }
    }
    const one = core(word);
    const placeholder = DATETIME_RE.test(one)
      ? ':datetime'
      : DATE_RES.some((re) => re.test(one))
        ? ':date'
        : TIME_RE.test(one)
          ? ':time'
          : null;
    if (placeholder !== null) {
      replacements.push({
        start: word.coreStart,
        end: word.coreEnd,
        text: placeholder,
        protect: true,
      });
    }
  }
  s.apply(replacements);
}

/** Rule K5: identifiers in word cores and in the segments of path words (06-REQ-35). */
function replaceIds(s: Masked, isId: IdMatcher): void {
  const replacements: Replacement[] = [];
  for (const word of s.words()) {
    const core = s.text.slice(word.coreStart, word.coreEnd);
    if (core.startsWith('/')) {
      let offset = word.coreStart;
      for (const part of core.split('/')) {
        const end = offset + part.length;
        if (part !== '' && !s.protectedIn(offset, end)) {
          const placeholder = isId(part);
          if (placeholder !== null) {
            replacements.push({ start: offset, end, text: placeholder, protect: true });
          }
        }
        offset = end + 1;
      }
      continue;
    }
    if (core === '' || s.protectedIn(word.coreStart, word.coreEnd)) continue;
    const placeholder = isId(core);
    if (placeholder !== null) {
      replacements.push({
        start: word.coreStart,
        end: word.coreEnd,
        text: placeholder,
        protect: true,
      });
    }
  }
  s.apply(replacements);
}

/** Stage 3, key stability (06-REQ-35): rules K1–K5. */
function stability(s: Masked, opts: SanitizeOptions, isId: IdMatcher): void {
  replaceMatches(s, TEMPLATE_RE, ':value');
  if (opts.redactQuotedValues) redactQuotes(s);
  replaceDates(s);
  replaceCores(s, (core) => (NUMBER_RES.some((re) => re.test(core)) ? ':num' : null));
  replaceIds(s, isId);
}

/** Stage 4, length (06-REQ-36): at most 200 code points. */
function limitLength(text: string): string {
  const points = [...text];
  return points.length > MAX_SEGMENT_LENGTH
    ? `${points.slice(0, MAX_SEGMENT_LENGTH - 1).join('')}…`
    : text;
}

/**
 * Returns a sanitizer bound to the options; compiles the id patterns once (06-REQ-24).
 * `keys.keyBuilder` never applies to step keys.
 */
export function createStepTitleSanitizer(opts: SanitizeOptions): (title: string) => SanitizedTitle {
  const isId = compileIdMatcher({
    idPatterns: opts.idPatterns,
    extraIdPatterns: opts.extraIdPatterns,
  } as ResolvedConfig['keys']);
  return (title) => {
    const cleaned = cleanup(title);
    if (cleaned === null) return { text: UNTITLED, redacted: [] };
    const s = new Masked(cleaned);
    const redacted = privacy(s);
    if (opts.normalizeTitles) stability(s, opts, isId);
    return { text: limitLength(s.text), redacted };
  };
}

/** Sanitizes one step title (06-REQ-24). */
export function sanitizeStepTitle(title: string, opts: SanitizeOptions): SanitizedTitle {
  return createStepTitleSanitizer(opts)(title);
}
