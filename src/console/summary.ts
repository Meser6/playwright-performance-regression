// Console summary at the end of a perf-mode run (09, chapter 8; F-12). A function of the run
// report only (01-REQ-22), so `npx pw-perf report` can print it again. Pure: the caller passes the
// terminal width, the color decision and the current directory, and prints the text.
import type { Check, Issue, KeyEvaluation, Kind, RunReport } from '../core/types/index.ts';
import { painter } from './color.ts';
import type { ColorStyle, Painter } from './color.ts';
import { compareText, padEnd, padStart, plural, textWidth, truncateMiddle } from './text.ts';

export { truncateMiddle };

export interface SummaryOptions {
  /** Terminal columns; 120 without a terminal (09-REQ-22). */
  width: number;
  /** ANSI colors: see colorEnabled (09-REQ-22, 04-REQ-44). */
  color: boolean;
  /** Directory the report paths are shown relative to. */
  cwd: string;
  /** Whether report.html was written; default: report.html of the config snapshot. */
  html?: boolean;
}

/** At most this many warnings are listed; tool errors are always listed in full (chapter 8.1). */
export const MAX_WARNINGS = 10;
/** At most this many violation rows (09-REQ-20). */
export const MAX_VIOLATION_ROWS = 20;
/** Slowest-sample lines for at most this many blocking keys (09-REQ-21). */
export const MAX_SLOWEST_LINES = 5;
/** Minimum width of the key column (09-REQ-22). */
export const MIN_KEY_WIDTH = 30;

const KINDS: readonly Kind[] = ['api', 'custom'];
const RULE_ORDER: readonly Check['rule'][] = [
  'median',
  'percentile',
  'p99',
  'apdex',
  'wilson',
  'errors',
];
const TIME_RULES: ReadonlySet<Check['rule']> = new Set<Check['rule']>([
  'median',
  'percentile',
  'p99',
]);

type Paint = Painter;

/**
 * Relative exceedance r of a failed check (09-REQ-19, 09-REQ-20): actual / limit for rules
 * failing on `>`, limit / actual for apdex; Infinity when the divisor is 0.
 */
export function exceedance(check: Pick<Check, 'rule' | 'actual' | 'limit'>): number {
  if (check.rule === 'apdex') return check.actual === 0 ? Infinity : check.limit / check.actual;
  return check.limit === 0 ? Infinity : check.actual / check.limit;
}

/** Column `over`: Math.round((r − 1) · 100) with "+" and "%", or ">999%" (09-REQ-19, 09-D-15). */
export function overText(check: Pick<Check, 'rule' | 'actual' | 'limit'>): string {
  const r = exceedance(check);
  if (!Number.isFinite(r)) return '>999%';
  const over = Math.round((r - 1) * 100);
  return over > 999 ? '>999%' : `+${over}%`;
}

interface Violation {
  kind: Kind;
  key: string;
  check: Check;
  evaluation: KeyEvaluation;
  r: number;
}

function violations(report: RunReport): Violation[] {
  const list: Violation[] = [];
  for (const kind of KINDS) {
    const aggregates = kind === 'api' ? report.endpoints : report.custom;
    for (const [key, aggregate] of Object.entries(aggregates)) {
      for (const check of aggregate.evaluation.checks) {
        if (!check.passed) {
          list.push({ kind, key, check, evaluation: aggregate.evaluation, r: exceedance(check) });
        }
      }
    }
  }
  // Blocking first, then by relative exceedance, kind, key and rule (09-REQ-20).
  return list.sort(
    (a, b) =>
      Number(b.check.blocking) - Number(a.check.blocking) ||
      (a.r === b.r ? 0 : b.r > a.r ? 1 : -1) ||
      KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) ||
      compareText(a.key, b.key) ||
      RULE_ORDER.indexOf(a.check.rule) - RULE_ORDER.indexOf(b.check.rule),
  );
}

function isMuted(evaluation: KeyEvaluation): boolean {
  return evaluation.muted !== null && !evaluation.muted.expired;
}

function header(report: RunReport): string {
  const t = report.tests;
  const executions = t.expected + t.unexpected + t.flaky;
  const details = [`${t.expected} passed`, `${t.unexpected} failed`];
  if (t.flaky > 0) details.push(`${t.flaky} flaky`);
  if (t.skipped > 0) details.push(`${t.skipped} skipped`);
  const parts = [report.tool.name, `mode: ${report.mode}`];
  if (report.env !== null) parts.push(`env: ${report.env}`);
  parts.push(`${plural(executions, 'test')} (${details.join(', ')})`);
  const ci = report.ci;
  if (ci !== null && (ci.branch !== null || ci.commit !== null)) {
    const commit = ci.commit === null ? '' : `@${ci.commit.slice(0, 7)}`;
    parts.push(`${ci.branch ?? ''}${commit}`);
  }
  return parts.join(' · ');
}

function issueLines(
  title: string,
  issues: readonly Issue[],
  limit: number,
  marker: string,
  more: string,
): string[] {
  if (issues.length === 0) return [];
  const lines = [title];
  for (const issue of issues.slice(0, limit)) {
    const times = issue.count !== undefined && issue.count > 1 ? ` (×${issue.count})` : '';
    lines.push(`  ${marker} ${issue.code}: ${issue.message}${times}`);
    if (issue.hint !== undefined) lines.push(`    Hint: ${issue.hint}`);
  }
  if (issues.length > limit) {
    lines.push(`  … and ${issues.length - limit} more ${more} (see report)`);
  }
  return [...lines, ''];
}

const LABEL_WIDTH = 'Endpoints: '.length;

function counterLines(report: RunReport): string[] {
  const counts = report.evaluation.counts;
  const shown = KINDS.filter(
    (kind) => kind === 'api' || counts.custom.keys > 0 || counts.custom.unseenThresholdEntries > 0,
  );
  const columns: { label: string; value: (kind: Kind) => number; optional?: boolean }[] = [
    { label: 'keys', value: (k) => counts[k].keys },
    { label: 'from file', value: (k) => counts[k].fromFile },
    { label: 'default', value: (k) => counts[k].fromDefaults },
    { label: 'too few samples', value: (k) => counts[k].tooFewSamples },
    { label: 'median only', value: (k) => counts[k].medianOnly },
    { label: 'unseen entries', value: (k) => counts[k].unseenThresholdEntries, optional: true },
    {
      label: 'not evaluated',
      value: (k) => counts[k].notEvaluated - counts[k].tooFewSamples,
      optional: true,
    },
  ];
  const used = columns.filter((c) => !c.optional || shown.some((k) => c.value(k) > 0));
  const widths = used.map((c) => Math.max(...shown.map((k) => String(c.value(k)).length)));
  return shown.map((kind) => {
    const label = padEnd(kind === 'api' ? 'Endpoints:' : 'Custom:', LABEL_WIDTH);
    const cells = used.flatMap((c, i) => {
      const value = c.value(kind);
      if (c.optional && value === 0) return [];
      const label = c.label === 'keys' && value === 1 ? 'key' : c.label;
      return [`${padStart(String(value), widths[i] ?? 0)} ${label}`];
    });
    return label + cells.join(' · ');
  });
}

function mutedLines(report: RunReport): string[] {
  const lines: string[] = [];
  for (const kind of KINDS) {
    const aggregates = kind === 'api' ? report.endpoints : report.custom;
    for (const key of Object.keys(aggregates).sort(compareText)) {
      const muted = aggregates[key]?.evaluation.muted;
      if (muted === undefined || muted === null || muted.expired) continue;
      const label = lines.length === 0 ? 'Muted:' : '';
      lines.push(`${padEnd(label, LABEL_WIDTH)}${key} until ${muted.until} — "${muted.note}"`);
    }
  }
  return lines;
}

function formatTime(ms: number): string {
  return `${Math.round(ms)} ms`;
}

function formatActual(check: Check): string {
  if (TIME_RULES.has(check.rule)) return formatTime(check.actual);
  const observed = check.observed === null ? '' : ` (${check.observed.toFixed(3)})`;
  return `${check.actual.toFixed(3)}${observed}`;
}

function formatLimit(check: Check): string {
  return TIME_RULES.has(check.rule) ? formatTime(check.limit) : check.limit.toFixed(3);
}

function tableLines(report: RunReport, list: Violation[], width: number, paint: Paint): string[] {
  const level = report.config.checks?.time?.percentile?.level ?? 'percentile';
  const shown = list.slice(0, MAX_VIOLATION_ROWS);
  const rows = shown.map((v) => ({
    marker: v.check.blocking ? '✖' : '!',
    kind: v.kind,
    key: v.key,
    rule: v.check.rule === 'percentile' ? level : v.check.rule,
    actual: formatActual(v.check),
    limit: formatLimit(v.check),
    over: overText(v.check),
    n: String(v.check.n),
    src: v.evaluation.thresholdSource,
    flag: [v.check.hardLimitExceeded ? 'HARD' : '', isMuted(v.evaluation) ? 'MUTED' : '']
      .filter((f) => f !== '')
      .join(' '),
  }));
  const head = {
    marker: ' ',
    kind: 'kind',
    key: 'key',
    rule: 'rule',
    actual: 'actual',
    limit: 'limit',
    over: 'over',
    n: 'n',
    src: 'src',
    flag: 'flag',
  };
  const all = [head, ...rows];
  const w = (field: keyof typeof head): number => Math.max(...all.map((r) => textWidth(r[field])));
  const widths = {
    kind: w('kind'),
    rule: w('rule'),
    actual: w('actual'),
    limit: w('limit'),
    over: w('over'),
    n: w('n'),
    src: w('src'),
    flag: w('flag'),
  };
  // "  M " + 9 gaps of 2 spaces between the remaining 10 columns.
  const fixed =
    4 +
    widths.kind +
    widths.rule +
    widths.actual +
    widths.limit +
    widths.over +
    widths.n +
    widths.src +
    widths.flag +
    2 * 8;
  const keyWidth = Math.max(MIN_KEY_WIDTH, Math.min(width - fixed, w('key')));
  const line = (r: typeof head, isHead: boolean): string => {
    const marker =
      isHead || r.marker === ' ' ? r.marker : paint(r.marker, r.marker === '✖' ? 'red' : 'yellow');
    const flag = r.flag.includes('HARD') && !isHead ? paint(r.flag, 'red') : r.flag;
    return [
      `  ${marker} ${padEnd(r.kind, widths.kind)}`,
      padEnd(truncateMiddle(r.key, keyWidth), keyWidth),
      padEnd(r.rule, widths.rule),
      padStart(r.actual, widths.actual),
      padStart(r.limit, widths.limit),
      padStart(r.over, widths.over),
      padStart(r.n, widths.n),
      padEnd(r.src, widths.src),
      flag,
    ]
      .join('  ')
      .trimEnd();
  };
  const lines = [line(head, true), ...rows.map((r) => line(r, false))];
  if (list.length > shown.length) {
    lines.push(`  … and ${list.length - shown.length} more violations (see report)`);
  }
  return lines;
}

/** Slowest sample of the first blocking keys (09-REQ-21, S-02). */
function slowestLines(report: RunReport, list: Violation[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const v of list) {
    if (!v.check.blocking || lines.length >= MAX_SLOWEST_LINES) continue;
    const id = `${v.kind}\u0000${v.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const aggregate = (v.kind === 'api' ? report.endpoints : report.custom)[v.key];
    const slowest = aggregate?.slowest[0];
    if (slowest === undefined) continue;
    const t = slowest.test;
    lines.push(
      `  slowest: ${v.key} — ${formatTime(slowest.duration)} in "${t.title}" (${t.file}:${t.line})`,
    );
  }
  return lines;
}

function resultLine(report: RunReport, paint: Paint): string {
  const counts = report.evaluation.counts;
  const sum = (field: 'violations' | 'blockingViolations' | 'keys' | 'notEvaluated'): number =>
    counts.api[field] + counts.custom[field];
  const gate = report.config.gate;
  const policy =
    gate?.warnOnly === true
      ? ' (gate.warnOnly)'
      : gate?.tolerance === undefined
        ? ''
        : ` (tolerance: ${gate.tolerance})`;
  let word: string;
  let style: ColorStyle;
  let reason: string;
  const status = report.evaluation.status;
  if (report.toolErrors.length > 0 || status === 'error') {
    word = 'ERROR';
    style = 'red';
    reason = `${plural(report.toolErrors.length, 'tool error')}; the result is not trustworthy`;
  } else if (status === 'failed') {
    word = 'FAILED';
    style = 'red';
    reason = `${plural(sum('blockingViolations'), 'blocking violation')}${policy}`;
  } else if (status === 'warned') {
    word = 'PASSED WITH WARNINGS';
    style = 'yellow';
    reason = `${plural(sum('violations'), 'key')} with violations, none blocking${policy}`;
  } else {
    word = 'PASSED';
    style = 'green';
    reason = `no violations in ${plural(sum('keys') - sum('notEvaluated'), 'evaluated key')}`;
  }
  const informational = report.mode === 'thresholds' ? ' (informational, gate disabled)' : '';
  return `${paint(word, style)}: ${reason}${informational}`;
}

// Minimal POSIX-style path handling; Windows separators are turned into "/".
function toSlash(path: string): string {
  return path.replace(/\\/gu, '/');
}

function rootOf(path: string): string {
  const drive = /^[A-Za-z]:\//u.exec(path);
  if (drive !== null) return drive[0];
  return path.startsWith('/') ? '/' : '';
}

function segments(path: string): string[] {
  const result: string[] = [];
  for (const part of path.slice(rootOf(path).length).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..' && result.length > 0 && result[result.length - 1] !== '..') result.pop();
    else result.push(part);
  }
  return result;
}

/** `to` relative to the directory `from`; both absolute or `to` is returned as it is. */
export function relativePath(from: string, to: string): string {
  const a = toSlash(from);
  const b = toSlash(to);
  if (rootOf(a) === '' || rootOf(a) !== rootOf(b)) return b;
  const x = segments(a);
  const y = segments(b);
  let common = 0;
  while (common < x.length && common < y.length && x[common] === y[common]) common += 1;
  const parts = [...x.slice(common).map(() => '..'), ...y.slice(common)];
  return parts.length === 0 ? '.' : parts.join('/');
}

function resolvePath(base: string, path: string): string {
  const p = toSlash(path);
  if (rootOf(p) !== '') return rootOf(p) + segments(p).join('/');
  const b = toSlash(base);
  return rootOf(b) + segments(`${b}/${p}`).join('/');
}

function reportLine(report: RunReport, cwd: string, html: boolean | undefined): string[] {
  const options = report.config.report;
  if (options?.dir === undefined) return [];
  const dir = resolvePath(report.configDir, options.dir);
  const withHtml = html ?? options.html !== false;
  const files = [...(withHtml ? ['report.html'] : []), 'report.json'];
  return [`Report: ${files.map((f) => relativePath(cwd, `${dir}/${f}`)).join(' · ')}`];
}

/** Console summary of a run report (09, chapter 8). Ends with a newline. */
export function formatSummary(report: RunReport, opts: SummaryOptions): string {
  const paint: Paint = painter(opts.color);
  const list = violations(report);
  const lines: string[] = [header(report), ''];
  lines.push(...issueLines('Errors:', report.toolErrors, Infinity, paint('✖', 'red'), 'errors'));
  lines.push(
    ...issueLines('Warnings:', report.warnings, MAX_WARNINGS, paint('!', 'yellow'), 'warnings'),
  );
  lines.push(...counterLines(report), ...mutedLines(report), '');
  if (list.length > 0) {
    lines.push(...tableLines(report, list, opts.width, paint));
    const slowest = slowestLines(report, list);
    if (slowest.length > 0) lines.push('', ...slowest);
    lines.push('');
  }
  lines.push(resultLine(report, paint), ...reportLine(report, opts.cwd, opts.html));
  return `${lines.join('\n')}\n`;
}
