// Console summary at the end of a perf-mode run (09, chapter 8; F-12). A function of the run
// report only (01-REQ-22). Pure: the caller passes the
// terminal width, the color decision and TERM=dumb, and prints the text. Frames, tables, emoji and
// colors follow 09-REQ-27; without colors the text is the same apart from the ANSI sequences.
import {
  exceedance,
  formatActual,
  formatLimit,
  formatMs,
  overText,
} from '../core/format/violation.ts';
import { KINDS } from '../core/types/index.ts';
import type {
  Check,
  Generated,
  Issue,
  KeyEvaluation,
  Kind,
  RunReport,
} from '../core/types/index.ts';
import { boxLines, marks, table } from './box.ts';
import type { BoxLine, Marks, TableColumn, TableRow } from './box.ts';
import { painter } from './color.ts';
import type { ColorStyle, Painter } from './color.ts';
import { compareText, plural, textWidth, truncateMiddle } from './text.ts';

export { exceedance, overText, truncateMiddle };

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
/** At most this many rows in the table of keys on default thresholds (09-REQ-37). */
export const MAX_DEFAULT_ROWS = 10;
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
  'nonSuccess',
];
type Paint = Painter;

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

interface DefaultKey {
  kind: Kind;
  key: string;
  aggregate: RunReport['endpoints'][string];
  /** 2: a blocking violation, 1: a violation that does not block, 0: passed. */
  rank: number;
}

/**
 * Keys evaluated with default thresholds although the file of their kind has entries, as for
 * THRESHOLDS_KEYS_ON_DEFAULTS (09-REQ-36), taken from the report alone (09-REQ-37): test mode,
 * a loaded file with entries (a key from the file or unseen entries). Sorted for the table.
 */
function keysOnDefaults(report: RunReport): DefaultKey[] {
  if (report.mode !== 'test') return [];
  const list: DefaultKey[] = [];
  for (const kind of KINDS) {
    const file = report.thresholdFiles.find((f) => f.kind === kind);
    if (file?.status !== 'loaded') continue;
    const aggregates = Object.entries(aggregatesOf(report, kind));
    const hasEntries =
      file.unseenKeys.length > 0 ||
      aggregates.some(([, a]) => a.evaluation.thresholdSource === 'file');
    if (!hasEntries) continue;
    for (const [key, aggregate] of aggregates) {
      const e = aggregate.evaluation;
      if (e.thresholdSource !== 'default' || e.result === 'not-evaluated') continue;
      const failed = e.checks.filter((c) => !c.passed);
      const rank = failed.some((c) => c.blocking) ? 2 : failed.length > 0 ? 1 : 0;
      list.push({ kind, key, aggregate, rank });
    }
  }
  // Blocking violations first, then other violations, then passed; by kind and key (09-REQ-37).
  return list.sort(
    (a, b) =>
      b.rank - a.rank || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || compareText(a.key, b.key),
  );
}

/** Table of the keys on default thresholds (09-REQ-37), under the counters. */
function defaultKeyLines(report: RunReport, opts: FrameOptions, m: Marks, paint: Paint): string[] {
  const list = keysOnDefaults(report);
  if (list.length === 0) return [];
  const level = report.config.checks?.time?.percentile?.level ?? 'percentile';
  const ms = (value: number | undefined): string => (value === undefined ? '—' : formatMs(value));
  const columns: TableColumn[] = [
    { header: '' },
    { header: 'kind' },
    { header: 'key', flex: true, minWidth: MIN_KEY_WIDTH },
    { header: 'n', align: 'right' },
    { header: 'median', align: 'right' },
    { header: level, align: 'right' },
    { header: 'limit', align: 'right' },
    { header: 'result' },
  ];
  const shown = list.slice(0, MAX_DEFAULT_ROWS);
  const rows: TableRow[] = shown.map(({ kind, key, aggregate, rank }) => {
    const limits = aggregate.evaluation.limits;
    const percentiles = aggregate.stats?.percentiles;
    return {
      cells: [
        rank === 2 ? m.error : rank === 1 ? m.warn : m.ok,
        kind,
        key,
        String(aggregate.successCount),
        ms(percentiles?.['p50']),
        ms(percentiles?.[level]),
        `${Math.round(limits.median)} / ${formatMs(limits.percentile)}`,
        rank === 0 ? 'pass' : 'fail',
      ],
      ...(rank === 2 ? { style: 'red' } : rank === 1 ? { style: 'yellow' } : {}),
    };
  });
  const lines = [
    paint('On default thresholds (no entry in the thresholds file):', 'bold'),
    ...table(columns, rows, opts),
  ];
  if (list.length > shown.length) {
    const more = plural(
      list.length - shown.length,
      'more key on default thresholds',
      'more keys on default thresholds',
    );
    lines.push(paint(`  … and ${more} (see report)`, 'dim'));
  }
  return [...lines, ''];
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
      samplesCell(v.check, v.evaluation),
      v.evaluation.thresholdSource,
      [v.check.hardLimitExceeded ? 'HARD' : '', isMuted(v.evaluation) ? 'MUTED' : '']
        .filter((f) => f !== '')
        .join(' '),
    ],
    style: v.check.blocking ? 'red' : 'yellow',
    // Samples per pass changed much since the thresholds run (09-REQ-42).
    ...(v.evaluation.workload?.shifted === true
      ? {
          cellStyles: [
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            'yellow',
          ],
        }
      : {}),
  }));
  const lines = table(columns, rows, opts);
  if (list.length > shown.length) {
    const more = plural(list.length - shown.length, 'more violation', 'more violations');
    lines.push(paint(`  … and ${more} (see report)`, 'dim'));
  }
  return lines;
}

/** Rules counting all samples (N); the others count timed samples (m) (09, table in 5.2). */
const ALL_SAMPLE_RULES: ReadonlySet<Check['rule']> = new Set<Check['rule']>([
  'errors',
  'nonSuccess',
]);

/**
 * Column `n`: the samples of the check, with the samples of the thresholds run when the entry has
 * a source block: `12/40` (09-REQ-42).
 */
function samplesCell(check: Check, evaluation: KeyEvaluation): string {
  const base = evaluation.workload?.base;
  if (base === undefined) return String(check.n);
  const n = ALL_SAMPLE_RULES.has(check.rule) ? base.count : base.successCount;
  return `${String(check.n)}/${String(n)}`;
}

/** "5 passes · 1 worker · 1,240 samples" (09-REQ-42). */
function workloadText(passes: number, workers: number, samples: number): string {
  return `${plural(passes, 'pass', 'passes')} · ${plural(workers, 'worker')} · ${plural(samples, 'sample')}`.replace(
    /(\d{4,}) sample/u,
    (_, n: string) => `${Number(n).toLocaleString('en-US')} sample`,
  );
}

/**
 * `Workload:` under the violations table (09-REQ-42): passes, workers and timed samples of this
 * run and of the thresholds run, for the first thresholds file whose generated block has
 * sourcePasses (written by 1.1.0 or later); empty otherwise.
 */
function workloadLines(report: RunReport, paint: Paint): string[] {
  for (const kind of KINDS) {
    // A copy of the file's generated block (an object in the report schema).
    const generated = report.thresholdFiles.find((f) => f.kind === kind)?.generated as
      Partial<Generated> | null | undefined;
    if (generated?.sourcePasses === undefined || generated.sourceSampleCount === undefined) {
      continue;
    }
    const samples = Object.values(aggregatesOf(report, kind)).reduce(
      (sum, a) => sum + a.successCount,
      0,
    );
    const now = workloadText(report.passes.completed, report.runConditions.workers, samples);
    const base = workloadText(generated.sourcePasses, 1, generated.sourceSampleCount);
    return [paint(`  Workload: ${now} (thresholds run: ${base})`, 'dim')];
  }
  return [];
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
      `  slowest: ${v.key} — ${formatMs(slowest.duration)} in "${t.title}" (${t.file}:${t.line})`,
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
  // Violations are failed checks, counted with their keys as in the HTML report (09-D-20).
  const failed = (blocking: boolean): number =>
    KINDS.reduce(
      (total, kind) =>
        total +
        Object.values(aggregatesOf(report, kind)).reduce(
          (n, a) =>
            n + a.evaluation.checks.filter((c) => !c.passed && (!blocking || c.blocking)).length,
          0,
        ),
      0,
    );
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
    reason = `${plural(failed(true), 'blocking violation')} in ${plural(sum('blockingViolations'), 'key')}${policy}`;
  } else if (status === 'warned') {
    verdict = [m.warn, 'PASSED WITH WARNINGS', 'yellow', 'badge-yellow'];
    reason = `${plural(failed(false), 'violation')} in ${plural(sum('violations'), 'key')}, none blocking${policy}`;
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
  lines.push(...defaultKeyLines(report, frame, m, paint));
  if (list.length > 0) {
    lines.push(...tableLines(report, list, frame, m, paint));
    lines.push(...workloadLines(report, paint));
    const slowest = slowestLines(report, list);
    if (slowest.length > 0) lines.push(...slowest);
    lines.push('');
  }
  lines.push(...resultLines(report, frame, m), ...reportLine(report, opts.html, paint));
  return `${lines.join('\n')}\n`;
}
