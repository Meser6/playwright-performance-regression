// Console summary at the end of a perf-mode run (09, chapter 8; F-12). A function of the run
// report only (01-REQ-22), so `npx pw-perf report` can print it again. Pure: the caller passes the
// terminal width, the color decision and TERM=dumb, and prints the text. Frames, tables, emoji and
// colors follow 09-REQ-27; without colors the text is the same apart from the ANSI sequences.
import { KINDS } from '../core/types/index.ts';
import type { Check, Issue, KeyEvaluation, Kind, RunReport } from '../core/types/index.ts';
import { boxLines, marks, table } from './box.ts';
import type { BoxLine, Marks, TableColumn, TableRow } from './box.ts';
import { painter } from './color.ts';
import type { ColorStyle, Painter } from './color.ts';
import { compareText, plural, textWidth, truncateMiddle } from './text.ts';

export { truncateMiddle };

export interface SummaryOptions {
  /** Terminal columns; 120 without a terminal (09-REQ-22). */
  width: number;
  /** ANSI colors: see colorEnabled (09-REQ-22, 04-REQ-44). */
  color: boolean;
  /** TERM=dumb: ASCII frames and text marks instead of emoji (09-REQ-27); default false. */
  ascii?: boolean;
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

/** Column of each kind in the counter table (09-REQ-28). */
const KIND_LABEL: Record<Kind, string> = { api: 'Endpoints', step: 'Steps' };
const ALWAYS_SHOWN: ReadonlySet<Kind> = new Set<Kind>(['api']);

/** Aggregates of one kind in the report. */
function aggregatesOf(report: RunReport, kind: Kind): RunReport['endpoints'] {
  const byKind: Record<Kind, RunReport['endpoints']> = {
    api: report.endpoints,
    step: report.steps,
  };
  return byKind[kind];
}
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
    const aggregates = aggregatesOf(report, kind);
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

function header(report: RunReport, paint: Paint): string {
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
  return paint(parts.join(' · '), 'bold');
}

/** Layout shared by the summary and the check output. */
export interface FrameOptions {
  width: number;
  color: boolean;
  ascii: boolean;
}

/**
 * The box of tool errors (red) or warnings (yellow) with the count in the title (09, chapter 8.1);
 * no box without issues. Long messages wrap inside the box.
 */
export function issueBox(
  level: 'error' | 'warning',
  issues: readonly Issue[],
  limit: number,
  opts: FrameOptions,
): string[] {
  if (issues.length === 0) return [];
  const m = marks(opts.ascii);
  const [mark, style, name, more]: [string, ColorStyle, string, string] =
    level === 'error'
      ? [m.error, 'red', 'Errors', 'error']
      : [m.warn, 'yellow', 'Warnings', 'warning'];
  const indent = textWidth(mark) + 1;
  const lines: BoxLine[] = [];
  for (const issue of issues.slice(0, limit)) {
    const times = issue.count !== undefined && issue.count > 1 ? ` (×${issue.count})` : '';
    lines.push({
      spans: [{ text: `${mark} ${issue.code}`, style }, { text: `: ${issue.message}${times}` }],
      indent,
    });
    if (issue.hint !== undefined) {
      lines.push({
        text: `${' '.repeat(indent)}Hint: ${issue.hint}`,
        style: 'dim',
        indent: indent + 'Hint: '.length,
      });
    }
  }
  if (issues.length > limit) {
    lines.push({
      text: `… and ${plural(issues.length - limit, `more ${more}`, `more ${more}s`)} (see report)`,
      style: 'dim',
    });
  }
  return [
    ...boxLines(lines, {
      ...opts,
      border: style,
      title: `${opts.ascii ? '' : `${mark} `}${name} (${issues.length})`,
      wrap: true,
    }),
    '',
  ];
}

/** Counters per kind as a table (09-REQ-28): the keys row always, other rows when not all zero. */
function counterLines(report: RunReport, opts: FrameOptions): string[] {
  const counts = report.evaluation.counts;
  // Endpoints always; another kind only when it has keys or unseen file entries.
  const shown = KINDS.filter(
    (kind) =>
      ALWAYS_SHOWN.has(kind) || counts[kind].keys > 0 || counts[kind].unseenThresholdEntries > 0,
  );
  const percentileOff = report.config.checks?.time?.percentile?.enabled === false;
  const medianOnly = `checked by median only (${percentileOff ? 'percentile rule off' : 'few samples'})`;
  const counters: { text: string; value: (kind: Kind) => number }[] = [
    { text: 'keys', value: (k) => counts[k].keys },
    { text: 'from file', value: (k) => counts[k].fromFile },
    { text: 'on default thresholds', value: (k) => counts[k].fromDefaults },
    { text: 'skipped (too few samples)', value: (k) => counts[k].tooFewSamples },
    { text: 'not evaluated', value: (k) => counts[k].notEvaluated - counts[k].tooFewSamples },
    { text: medianOnly, value: (k) => counts[k].medianOnly },
    { text: 'file entries not seen', value: (k) => counts[k].unseenThresholdEntries },
  ];
  const rows: TableRow[] = counters
    .filter((c, i) => i === 0 || shown.some((kind) => c.value(kind) !== 0))
    .map((c) => ({ cells: [c.text, ...shown.map((kind) => String(c.value(kind)))] }));
  const columns: TableColumn[] = [
    { header: '' },
    ...shown.map((kind): TableColumn => ({ header: KIND_LABEL[kind], align: 'right' })),
  ];
  return table(columns, rows, opts);
}

function mutedLines(report: RunReport, paint: Paint): string[] {
  const lines: string[] = [];
  const indent = ' '.repeat('Muted: '.length);
  for (const kind of KINDS) {
    const aggregates = aggregatesOf(report, kind);
    for (const key of Object.keys(aggregates).sort(compareText)) {
      const muted = aggregates[key]?.evaluation.muted;
      if (muted === undefined || muted === null || muted.expired) continue;
      const head = lines.length === 0 ? `${paint('Muted:', 'bold')} ` : indent;
      lines.push(`${head}${key} until ${muted.until} — "${muted.note}"`);
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

function tableLines(
  report: RunReport,
  list: Violation[],
  opts: FrameOptions,
  m: Marks,
  paint: Paint,
): string[] {
  const level = report.config.checks?.time?.percentile?.level ?? 'percentile';
  const shown = list.slice(0, MAX_VIOLATION_ROWS);
  const columns: TableColumn[] = [
    { header: '' },
    { header: 'kind' },
    { header: 'key', flex: true, minWidth: MIN_KEY_WIDTH },
    { header: 'rule' },
    { header: 'actual', align: 'right' },
    { header: 'limit', align: 'right' },
    { header: 'over', align: 'right' },
    { header: 'n', align: 'right' },
    { header: 'src' },
    { header: 'flag' },
  ];
  // The whole row in one color: red when the violation blocks, yellow otherwise (09-REQ-27).
  const rows: TableRow[] = shown.map((v) => ({
    cells: [
      v.check.blocking ? m.error : m.warn,
      v.kind,
      v.key,
      v.check.rule === 'percentile' ? level : v.check.rule,
      formatActual(v.check),
      formatLimit(v.check),
      overText(v.check),
      String(v.check.n),
      v.evaluation.thresholdSource,
      [v.check.hardLimitExceeded ? 'HARD' : '', isMuted(v.evaluation) ? 'MUTED' : '']
        .filter((f) => f !== '')
        .join(' '),
    ],
    style: v.check.blocking ? 'red' : 'yellow',
  }));
  const lines = table(columns, rows, opts);
  if (list.length > shown.length) {
    const more = plural(list.length - shown.length, 'more violation', 'more violations');
    lines.push(paint(`  … and ${more} (see report)`, 'dim'));
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
    const aggregate = aggregatesOf(report, v.kind)[v.key];
    const slowest = aggregate?.slowest[0];
    if (slowest === undefined) continue;
    const t = slowest.test;
    lines.push(
      `  slowest: ${v.key} — ${formatTime(slowest.duration)} in "${t.title}" (${t.file}:${t.line})`,
    );
  }
  return lines;
}

/** Causes named in the ERROR verdict (09-REQ-29): run assessment errors by name, the rest counted. */
function errorCauses(report: RunReport): string[] {
  const t = report.tests;
  const named: Record<string, string> = {
    TESTS_FAILED_TOO_MANY: `too many failed tests (${t.unexpected} of ${t.expected + t.unexpected + t.flaky} executions)`,
    RUN_INCOMPLETE: 'the run did not complete',
    RUN_SHARDED: 'the run is sharded',
  };
  const causes: string[] = [];
  let other = 0;
  for (const issue of report.toolErrors) {
    const cause = named[issue.code];
    if (cause === undefined) other += 1;
    else if (!causes.includes(cause)) causes.push(cause);
  }
  if (other > 0) causes.push(plural(other, 'tool error'));
  return causes;
}

/** The verdict (09-REQ-29): a box in the verdict color with mark, badge and one sentence. */
function resultLines(report: RunReport, opts: FrameOptions, m: Marks): string[] {
  const counts = report.evaluation.counts;
  const sum = (field: 'violations' | 'blockingViolations' | 'keys' | 'notEvaluated'): number =>
    KINDS.reduce((total, kind) => total + counts[kind][field], 0);
  const gate = report.config.gate;
  const policy = gate?.tolerance === undefined ? '' : ` (tolerance: ${gate.tolerance})`;
  let verdict: [mark: string, word: string, color: ColorStyle, badge: ColorStyle];
  let reason: string;
  const status = report.evaluation.status;
  if (report.toolErrors.length > 0 || status === 'error') {
    verdict = [m.error, 'ERROR', 'magenta', 'badge-magenta'];
    const causes = errorCauses(report);
    reason = `${causes.length === 0 ? '' : `${causes.join(', ')}; `}the performance result is not trustworthy`;
  } else if (status === 'failed') {
    verdict = [m.error, 'FAILED', 'red', 'badge-red'];
    reason = `${plural(sum('blockingViolations'), 'blocking violation')}${policy}`;
  } else if (status === 'warned') {
    verdict = [m.warn, 'PASSED WITH WARNINGS', 'yellow', 'badge-yellow'];
    reason = `${plural(sum('violations'), 'key')} with violations, none blocking${policy}`;
  } else {
    verdict = [m.ok, 'PASSED', 'green', 'badge-green'];
    reason = `no violations in ${plural(sum('keys') - sum('notEvaluated'), 'evaluated key')}`;
  }
  const informational = report.mode === 'thresholds' ? ' (informational, gate disabled)' : '';
  const [mark, word, color, badge] = verdict;
  return verdictBox(mark, word, `${reason}${informational}`, color, badge, opts);
}

/** One-line verdict box: `<mark> <badge> <reason>` (09-REQ-29, 04-REQ-50). */
export function verdictBox(
  mark: string,
  word: string,
  reason: string,
  color: ColorStyle,
  badge: ColorStyle,
  opts: FrameOptions,
): string[] {
  const indent = textWidth(mark) + word.length + 4;
  return boxLines(
    [
      {
        spans: [{ text: `${mark} ` }, { text: ` ${word} `, style: badge }, { text: ` ${reason}` }],
        indent,
      },
    ],
    { ...opts, border: color, wrap: true },
  );
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

function resolvePath(base: string, path: string): string {
  const p = toSlash(path);
  if (rootOf(p) !== '') return rootOf(p) + segments(p).join('/');
  const b = toSlash(base);
  return rootOf(b) + segments(`${b}/${p}`).join('/');
}

/**
 * One line with the absolute path of report.html, or report.json without HTML (09-REQ-30):
 * terminals show an absolute path as a link whatever the current directory.
 */
function reportLine(report: RunReport, html: boolean | undefined, paint: Paint): string[] {
  const options = report.config.report;
  if (options?.dir === undefined) return [];
  const dir = resolvePath(report.configDir, options.dir);
  const file = (html ?? options.html !== false) ? 'report.html' : 'report.json';
  return [`${paint('Report:', 'bold')} ${dir}/${file}`];
}

/** Console summary of a run report (09, chapter 8). Ends with a newline. */
export function formatSummary(report: RunReport, opts: SummaryOptions): string {
  const paint: Paint = painter(opts.color);
  const frame: FrameOptions = { width: opts.width, color: opts.color, ascii: opts.ascii ?? false };
  const m = marks(frame.ascii);
  const list = violations(report);
  const lines: string[] = [
    paint('─'.repeat(Math.max(1, opts.width)), 'dim'),
    header(report, paint),
    '',
  ];
  lines.push(...issueBox('error', report.toolErrors, Infinity, frame));
  lines.push(...issueBox('warning', report.warnings, MAX_WARNINGS, frame));
  lines.push(...counterLines(report, frame), ...mutedLines(report, paint), '');
  if (list.length > 0) {
    lines.push(...tableLines(report, list, frame, m, paint));
    const slowest = slowestLines(report, list);
    if (slowest.length > 0) lines.push(...slowest);
    lines.push('');
  }
  lines.push(...resultLines(report, frame, m), ...reportLine(report, opts.html, paint));
  return `${lines.join('\n')}\n`;
}
