// Key tables and key details (11, chapters 6.4–6.9, 8a): one row per key in the default order
// (11-REQ-09) and its details block, a <details> under the row that the script shows in the key
// dialog (11-REQ-37).
import { overText } from '../core/format/violation.ts';
import type { Check, KeyEvaluation, RunReport } from '../core/types/index.ts';
import { percentileBar } from './bar.ts';
import { histogramSvg, ttfbSplitSvg } from './charts.ts';
import type { Mark } from './charts.ts';
import {
  DASH,
  KIND_LABEL,
  aggregatesOf,
  compareText,
  isBlocking,
  join,
  keyAnchor,
  keyLink,
  rowGroup,
  topCheck,
} from './context.ts';
import type { Ctx, LinkKind } from './context.ts';
import type { HtmlAggregate } from './data.ts';
import { html } from './escape.ts';
import type { HtmlValue, SafeHtml } from './escape.ts';
import { formatDate, formatMs, formatPercent, formatRatio, plural, usageText } from './format.ts';
import { hintText, ruleLabel } from './hints.ts';
import { icon } from './icons.ts';
import { endpointSource, keyView, stepDepth } from './keyview.ts';

export { KEY_COLUMN_MAX } from './context.ts';

/** Headroom from which the text and the meter turn orange (11-REQ-30, HINT_NEAR_LIMIT). */
export const NEAR_LIMIT = 0.9;

/** Error statuses when the config snapshot omits them: the schema default (03). */
const DEFAULT_ERROR_STATUSES = ['5xx', 'FAILED', 'PENDING'];

const TIME_RULES: ReadonlySet<Check['rule']> = new Set<Check['rule']>([
  'median',
  'percentile',
  'p99',
]);

// ---------------------------------------------------------------------------------------------
// Pills and tokens (11-REQ-41, 11-REQ-51): text and shape; colour only reinforces them

export function pill(cls: string, text: HtmlValue): SafeHtml {
  return html`<span class="pill${cls === '' ? '' : ` ${cls}`}">${text}</span>`;
}

export function resultPill(evaluation: KeyEvaluation): SafeHtml {
  if (evaluation.result === 'fail') {
    return isBlocking(evaluation) ? pill('fb', 'fail · blocking') : pill('f', 'fail');
  }
  return evaluation.result === 'pass' ? pill('p', 'pass') : pill('ne', 'not evaluated');
}

export function mutedPill(muted: KeyEvaluation['muted']): SafeHtml | null {
  if (muted === null) return null;
  const until = muted.until.slice(0, 10);
  return muted.expired
    ? pill('w', 'mute expired')
    : pill('', html`${icon('mute')}muted until ${until}`);
}

/** Source of the thresholds (`file`, `default`) as a small monospace token. */
export function sourceToken(source: string): SafeHtml {
  return html`<span class="src">${source}</span>`;
}

/** Kind of a key (`endpoint`, `step`) as a small token. */
export function kindToken(kind: LinkKind): SafeHtml {
  return html`<span class="kind">${KIND_LABEL[kind]}</span>`;
}

export function reasonText(reason: KeyEvaluation['reason']): string | null {
  switch (reason) {
    case 'too-few-samples':
      return 'too few samples';
    case 'no-rules':
      return 'no applicable rules';
    case 'thresholds-error':
      return 'thresholds file invalid';
    default:
      return null;
  }
}

/** Class of a headroom text: red over the limit, orange from 0.9 (11-REQ-30). */
function usageClass(usage: number | null, failed: boolean): string {
  if (failed || usage === null || usage > 1) return 'ov';
  return usage >= NEAR_LIMIT ? 'nr' : '';
}

/** Rules on shares: the gate compares a confidence bound with the limit (09-REQ-09). */
const SHARE_RULES: ReadonlySet<Check['rule']> = new Set<Check['rule']>([
  'apdex',
  'wilson',
  'errors',
]);

/**
 * The excess of a failed check as in the console column `over` (09-REQ-19, 11-REQ-30): `+111%`
 * or `+81 pp`; undefined for a passed check and for a time rule with limit 0 ("over (limit 0)").
 */
export function overOf(
  check: Pick<Check, 'rule' | 'actual' | 'limit' | 'passed' | 'usage'>,
): string | undefined {
  if (check.passed) return undefined;
  if (!SHARE_RULES.has(check.rule) && check.usage === null) return undefined;
  return overText(check);
}

/**
 * `<meter>` of a check's usage with its text (11-REQ-30). The meter is inside a <label> with the
 * text, which gives it its accessible name without an id per check.
 */
export function usageMeter(
  check: Pick<Check, 'usage' | 'rule' | 'actual' | 'limit' | 'passed'>,
  long = false,
): SafeHtml {
  const usage = check.usage;
  const failed = !check.passed;
  const value = usage === null ? 1.25 : Math.min(usage, 1.25);
  const cls = usageClass(usage, failed);
  return html`<label class="hr"><meter max="1.25" low="0.9" high="1" optimum="0" value="${value}"></meter><b${cls === '' ? null : html` class="${cls}"`}>${usageText(usage, failed, long, overOf(check))}</b></label>`;
}

/**
 * A value of a check (11-REQ-19): a time for the time rules, a percentage for the error rate and
 * a share with three decimals for Apdex and the slow share.
 */
export function checkValue(check: Pick<Check, 'rule'>, value: number): string {
  if (TIME_RULES.has(check.rule)) return formatMs(value);
  return check.rule === 'errors' ? formatPercent(value) : formatRatio(value);
}

// ---------------------------------------------------------------------------------------------
// Key details (11, chapter 6.5, 11-REQ-60)

function lowestMinSamples(report: RunReport, level: string): { rule: string; n: number } | null {
  const checks = report.config.checks;
  if (checks === undefined) return null;
  const rules: [string, { enabled?: boolean; minSamples?: number } | undefined][] = [
    ['median', checks.time?.median],
    [level, checks.time?.percentile],
    ['p99', checks.time?.p99],
    ['apdex', checks.slowShare?.apdex],
    ['wilson', checks.slowShare?.wilson],
    ['errors', checks.errors],
  ];
  let best: { rule: string; n: number } | null = null;
  for (const [rule, cfg] of rules) {
    if (cfg?.enabled === false || cfg?.minSamples === undefined) continue;
    if (best === null || cfg.minSamples < best.n) best = { rule, n: cfg.minSamples };
  }
  return best;
}

/** A section of the details block: a small heading with a muted note on the right. */
function part(title: string, note: HtmlValue, ...content: HtmlValue[]): SafeHtml {
  return html`<div class="ds"><h4>${title}${note === null ? null : html` <span class="sub">${note}</span>`}</h4>${content}</div>`;
}

function checkPill(c: Check): SafeHtml {
  if (c.passed) return pill('p', 'pass');
  if (c.hardLimitExceeded) return pill('fb', 'hard limit');
  return c.blocking ? pill('fb', 'blocking') : pill('f', 'fail');
}

/** The lowest T of derived thresholds of a kind (10, `derivation.t.min`), or null. */
function lowestT(report: RunReport, kind: LinkKind): number | null {
  // `generated` is free-form in the run report schema: read it field by field.
  let value: unknown = report.thresholdFiles.find((f) => f.kind === kind)?.generated;
  for (const name of ['derivation', 't', 'min']) {
    value =
      typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)[name]
        : undefined;
  }
  return typeof value === 'number' ? value : null;
}

/** Legend under the checks table: what Raw and Bound are, and T (11, chapter 6.5). */
function checksLegend(ctx: Ctx, kind: LinkKind, agg: HtmlAggregate): SafeHtml | null {
  const checks = agg.evaluation.checks;
  const lines: string[] = [];
  if (checks.some((c) => SHARE_RULES.has(c.rule))) {
    lines.push(
      'Raw is measured in this run; time rules compare it with the limit. Share rules compare Bound, the 95% confidence bound (upper for Apdex, lower otherwise), so chance alone does not fail them.',
    );
  }
  const t = agg.evaluation.limits.t;
  if (t !== null && checks.some((c) => c.rule === 'apdex' || c.rule === 'wilson')) {
    lines.push(
      lowestT(ctx.report, kind) === t
        ? `T = ${formatMs(t)}, the lowest allowed for ${kind === 'step' ? 'steps' : 'endpoints'}: faster samples count as satisfied, so Apdex and slow share can pass while the percentiles fail.`
        : `T = ${formatMs(t)}: slower samples count as slow.`,
    );
  }
  return lines.length === 0 ? null : html`<p class="legend">${lines.join(' ')}</p>`;
}

function checksTable(ctx: Ctx, kind: LinkKind, agg: HtmlAggregate): SafeHtml {
  const ev = agg.evaluation;
  if (ev.result === 'not-evaluated') {
    const reason = reasonText(ev.reason);
    const lowest = lowestMinSamples(ctx.report, ctx.level);
    return part(
      'Checks',
      null,
      html`<p>Not evaluated${reason === null ? '' : `: ${reason}`}.`,
      lowest === null
        ? null
        : ` The lowest rule (${lowest.rule}) needs ${plural(lowest.n, 'sample')}; this key has ${String(agg.successCount)} successful of ${plural(agg.count, 'sample')}.`,
      html`</p>`,
    );
  }
  const ns = new Set(ev.checks.map((c) => c.n));
  const commonN = ns.size === 1 ? [...ns][0] : undefined;
  // Raw: the value measured in this run; Bound: the confidence bound of a share rule (09-REQ-09).
  const bound = ev.checks.some((c) => SHARE_RULES.has(c.rule));
  const row = (c: Check): SafeHtml => {
    const share = SHARE_RULES.has(c.rule);
    // The value the gate compared with the limit is red when the check failed.
    const ov = c.passed ? null : html` class="ov"`;
    const raw = share ? c.observed : c.actual;
    return join(
      html`<tr><th scope="row">${ruleLabel(c.rule, ctx.level)}</th>`,
      // Numbers are right-aligned by the table style, without a class per cell.
      commonN === undefined ? html`<td>${c.n}</td>` : null,
      html`<td${share ? null : ov}>${raw === null ? null : checkValue(c, raw)}</td>`,
      bound ? html`<td${share ? ov : null}>${share ? checkValue(c, c.actual) : null}</td>` : null,
      html`<td>${checkValue(c, c.limit)}</td><td>`,
      ctx.migrated ? DASH : usageMeter(c, true),
      html`</td><td>${checkPill(c)}</td></tr>`,
    );
  };
  return part(
    'Checks',
    commonN === undefined ? null : `n = ${String(commonN)} for every rule`,
    html`<div class="ct" tabindex="0"><table class="ck"><caption>Checks</caption><thead><tr><th scope="col">Rule</th>`,
    commonN === undefined ? html`<th scope="col" class="num">n</th>` : null,
    html`<th scope="col" class="num">Raw</th>`,
    bound ? html`<th scope="col" class="num">Bound</th>` : null,
    html`<th scope="col" class="num">Limit</th><th scope="col">Limit used</th><th scope="col">Result</th></tr></thead>`,
    html`<tbody>${ev.checks.map(row)}</tbody></table></div>`,
    checksLegend(ctx, kind, agg),
  );
}

/** Value with a smaller unit: `640<small> ms</small>` (11-REQ-60). */
export function msValue(value: number): SafeHtml {
  const [number, unit] = formatMs(value).split(' ');
  return html`${number}<small> ${unit}</small>`;
}

/**
 * Statuses of a key without timed samples that the Errors column does not count, e.g. "5 × 404
 * (not timed)" (11, chapter 6.4, F2 decision 6): at most 3 labels by count descending, then by
 * label; null with timed samples or when every sample is an error.
 */
export function notTimedNote(ctx: Ctx, kind: LinkKind, agg: HtmlAggregate): string | null {
  if (agg.successCount > 0 || agg.count === 0) return null;
  const errors = ctx.report.config.checks?.errors?.statuses ?? DEFAULT_ERROR_STATUSES;
  // A step sample is an error by its outcome (08-REQ-30), a request sample by its status.
  const counted = (label: string): boolean =>
    kind === 'step' ? label !== 'ok' : isErrorStatus(label, errors);
  const labels = Object.entries(agg.statuses)
    .filter(([label]) => !counted(label))
    .sort(([a, n], [b, m]) => m - n || compareText(a, b));
  const shown = labels.slice(0, NOT_TIMED_LABELS).map(([label, n]) => `${String(n)} × ${label}`);
  const more = labels.length - shown.length;
  if (shown.length === 0) return null;
  return `${shown.join(', ')}${more > 0 ? ` +${String(more)} more` : ''} (not timed)`;
}

const NOT_TIMED_LABELS = 3;

/**
 * The limit of a time rule when the rule was evaluated, null when it has no check (too few samples
 * for its minSamples, rule off or key not evaluated, 09-REQ-07): the page shows "not evaluated"
 * or "/ —" instead of a limit that decided nothing (11, chapters 6.4 and 6.5).
 */
function evaluatedLimit(
  agg: HtmlAggregate,
  rule: Check['rule'],
  limit: number | null,
): number | null {
  return agg.evaluation.checks.some((c) => c.rule === rule) ? limit : null;
}

/** p50, the evaluated percentile and p99 with their limits, and max (11-REQ-60). */
function statsGrid(ctx: Ctx, kind: LinkKind, agg: HtmlAggregate): SafeHtml {
  const stats = agg.stats;
  if (stats === null) {
    const note = notTimedNote(ctx, kind, agg);
    return html`<div class="ds"><p>No successful timed samples${note === null ? '' : `: ${note}`}.</p></div>`;
  }
  const limits = agg.evaluation.limits;
  const cell = (
    label: string,
    value: number | undefined,
    limit: number | null | undefined,
  ): SafeHtml => {
    const over = value !== undefined && limit != null && value > limit;
    const note =
      limit === undefined
        ? null
        : limit === null
          ? ' · not evaluated'
          : ` · limit ${formatMs(limit)}`;
    return html`<div${over ? html` class="ov"` : null}><dt>${label}${note}</dt><dd>${value === undefined ? DASH : msValue(value)}</dd></div>`;
  };
  return html`<div class="ds"><dl class="stats">${[
    cell('p50', stats.percentiles['p50'], undefined),
    cell(
      ctx.level,
      stats.percentiles[ctx.level],
      evaluatedLimit(agg, 'percentile', limits.percentile),
    ),
    cell('p99', stats.percentiles['p99'], evaluatedLimit(agg, 'p99', limits.p99)),
    cell('max', stats.max, undefined),
  ]}</dl></div>`;
}

/** Histogram (11-REQ-32), the percentile bar of a migrated report (11-REQ-11), or nothing. */
function distribution(ctx: Ctx, agg: HtmlAggregate): SafeHtml | null {
  const stats = agg.stats;
  if (stats === null) return null;
  if (agg.histogram === null) {
    const bar = percentileBar(stats, agg.evaluation.limits, ctx.level);
    return bar === null ? null : part('Percentiles', null, bar);
  }
  const markers: Mark[] = [];
  for (const name of ['p50', ctx.level, 'p99']) {
    const value = stats.percentiles[name];
    if (value !== undefined && !markers.some((m) => m.label === name)) {
      markers.push({ label: name, value });
    }
  }
  const limit = agg.evaluation.limits.percentile;
  return part(
    'Distribution',
    agg.samples.sampled
      ? `${String(agg.samples.retained)} retained samples (uniform sample)`
      : plural(agg.samples.retained, 'retained sample'),
    histogramSvg({
      edges: agg.histogram.edges,
      counts: agg.histogram.counts,
      markers,
      limit: { label: 'limit', value: limit, limit: true },
      retained: agg.samples.retained,
      sampled: agg.samples.sampled,
    }),
    html`<p class="legend"><span><i class="s-neu"></i>within limit</span><span><i class="s-bad"></i>above limit</span><span><i class="lg-lim"></i>${ctx.level} limit</span></p>`,
  );
}

/** `file:line` of a step key, a dash without one (11-REQ-47). */
function locationText(agg: HtmlAggregate): string {
  const loc = agg.location;
  // Playwright gives no location for box: true steps (11-REQ-47, F2 decision 36).
  return loc == null ? 'boxed step (no location)' : `${loc.file}:${String(loc.line)}`;
}

/** TTFB split of an endpoint (11-REQ-33). */
function ttfbSplit(agg: HtmlAggregate): SafeHtml | null {
  const ttfb = agg.ttfb;
  if (ttfb === null || ttfb.otherP50 === null || agg.stats === null) return null;
  const svg = ttfbSplitSvg(ttfb.p50, ttfb.otherP50);
  if (svg === null) return null;
  const sum = formatMs(Math.round((ttfb.p50 + ttfb.otherP50) * 10) / 10);
  const p50 = formatMs(agg.stats.percentiles['p50'] ?? 0);
  return part(
    'Server wait vs rest',
    'p50 of each part',
    svg,
    html`<p class="legend"><span><i class="s-acc"></i>Server wait (TTFB p50) ${formatMs(ttfb.p50)}</span><span><i class="s-trk"></i>Rest (p50 of duration − TTFB) ${formatMs(ttfb.otherP50)}</span></p>`,
    // Only when the numbers differ (11-REQ-33).
    sum === p50
      ? null
      : html`<p class="sub">Medians of each part: their sum (${sum}) can differ from p50 of the duration (${p50}).</p>`,
  );
}

/** Whether a status label counts as an error (`checks.errors.statuses`, 08). */
function isErrorStatus(label: string, statuses: readonly string[]): boolean {
  return statuses.some(
    (s) => s === label || (/^\dxx$/u.test(s) && /^\d{3}$/u.test(label) && s[0] === label[0]),
  );
}

/** The header of a details block: full key, pills and counts (11-REQ-60). */
function keyHeader(ctx: Ctx, kind: LinkKind, key: string, agg: HtmlAggregate): SafeHtml {
  const ev = agg.evaluation;
  // An endpoint with its method badge and the origin label as a token (11-REQ-53).
  const full =
    kind === 'api' ? keyView(kind, key, Number.MAX_SAFE_INTEGER, false, ctx.report.origins) : key;
  return html`<div class="kh"><p class="fkl"><code class="fk">${full}</code></p><p class="pills">${[
    resultPill(ev),
    kindToken(kind),
    sourceToken(ev.thresholdSource),
    mutedPill(ev.muted),
  ]}<span class="sub">${plural(agg.count, 'sample')} · ${plural(agg.testCount, 'test')}</span></p></div>`;
}

function testRef(t: { project: string; file: string; line: number }): SafeHtml {
  const project = t.project === '' ? 'default project' : t.project;
  return html`<code>${t.file}:${t.line}</code> · ${project}`;
}

/** Statuses as tokens, then the facts of the key (11, chapter 6.5). */
function statusesPart(ctx: Ctx, kind: LinkKind, key: string, agg: HtmlAggregate): SafeHtml {
  const request = kind === 'api' && endpointSource(key) === 'request';
  const errors = ctx.report.config.checks?.errors?.statuses ?? DEFAULT_ERROR_STATUSES;
  const labels = Object.keys(agg.statuses).sort();
  const facts: HtmlValue[] = [
    html`<span>From failed tests: ${agg.fromFailedTests}</span>`,
    agg.timeSources.node > 0 && !request
      ? html`<span>Time sources: browser ${agg.timeSources.browser}, node ${agg.timeSources.node}</span>`
      : null,
    kind === 'step' ? html`<span>Defined at: <code>${locationText(agg)}</code></span>` : null,
    kind === 'step' && (agg.stepErrorsFromFailedTests ?? 0) > 0
      ? html`<span>Step errors in failed tests (not counted): ${agg.stepErrorsFromFailedTests ?? 0}</span>`
      : null,
    request ? html`<span>Source: request (worker clock)</span>` : null,
    kind === 'api' && !request
      ? html`<span>TTFB: ${agg.ttfb === null ? DASH : `p50 ${formatMs(agg.ttfb.p50)}, p95 ${formatMs(agg.ttfb.p95)}`}</span>`
      : null,
    html`<span>Retained samples: ${
      agg.samples.sampled
        ? `${String(agg.samples.retained)} (uniform sample of ${String(agg.successCount)}; the histogram shows them)`
        : `${String(agg.samples.retained)} (all successful)`
    }</span>`,
  ];
  return part(
    'Statuses',
    null,
    labels.length === 0
      ? null
      : html`<p class="stc">${labels.map(
          (s) =>
            html`<span${isErrorStatus(s, errors) ? html` class="e"` : null}><b>${s}</b> × ${agg.statuses[s] ?? 0}</span>`,
        )}</p>`,
    html`<p class="facts">${facts}</p>`,
  );
}

/** Content of the details block of a key (11-REQ-60). */
export function keyDetails(ctx: Ctx, kind: LinkKind, key: string, agg: HtmlAggregate): SafeHtml {
  const hints = ctx.migrated ? [] : agg.hints;
  return join(
    html`<div class="kd">`,
    keyHeader(ctx, kind, key, agg),
    hints.length === 0
      ? null
      : html`<ul class="hints">${hints.map((h) => html`<li>${icon('bulb')}${hintText(h, ctx.level, agg.evaluation.muted, kind)}</li>`)}</ul>`,
    statsGrid(ctx, kind, agg),
    distribution(ctx, agg),
    checksTable(ctx, kind, agg),
    kind === 'api' ? ttfbSplit(agg) : null,
    statusesPart(ctx, kind, key, agg),
    agg.slowest.length === 0
      ? null
      : part(
          'Slowest samples',
          null,
          html`<ol class="samples">${agg.slowest.map((s) =>
            join(
              html`<li><b>${formatMs(s.duration)}</b><span class="tt"><span>${s.test.title}</span>`,
              html`<span class="sub">${testRef(s.test)} · rep ${s.test.repeatEachIndex} · ${formatDate(s.startedAt)}</span>`,
              s.url === undefined ? null : html`<span class="url">${s.url}</span>`,
              html`</span></li>`,
            ),
          )}</ol>`,
        ),
    agg.topTests.length === 0
      ? null
      : part(
          'Top tests',
          'by samples',
          html`<ul class="tl two">${agg.topTests.map(
            (t) =>
              html`<li><span class="tt"><span>${t.title}</span><span class="sub">${t.file}:${t.line}</span></span><span class="num">${plural(t.sampleCount, 'sample')}</span></li>`,
          )}</ul>`,
        ),
    html`</div>`,
  );
}

// ---------------------------------------------------------------------------------------------
// Key table (11, chapter 6.4, 11-REQ-54)

/** Status class of a row (11-REQ-54). */
export function rowClass(evaluation: KeyEvaluation): string {
  const group = rowGroup(evaluation);
  if (group === 0) return 'blocking';
  if (group === 1) {
    return evaluation.muted !== null && !evaluation.muted.expired ? 'muted' : 'violation';
  }
  return group === 2 ? 'pass' : 'not-evaluated';
}

/** A time of a key table: whole ms without a unit (11-REQ-19, 11-D-25). */
function timeCell(value: number | undefined): SafeHtml {
  return value === undefined
    ? html`<td class="num z">${DASH}</td>`
    : html`<td class="num">${Math.round(value)}</td>`;
}

/**
 * Percentile with its limit, `1240 / 900`; red and bold over the limit; `/ —` when the rule was
 * not evaluated (11, chapter 6.4).
 */
function limitCell(value: number | undefined, limit: number | null): SafeHtml {
  if (value === undefined) return html`<td class="num z">${DASH}</td>`;
  const over = limit !== null && value > limit;
  return html`<td class="num${over ? ' ov' : ''}">${Math.round(value)}<span class="lim"> / ${limit === null ? DASH : Math.round(limit)}</span></td>`;
}

/** Headroom cell: the key's largest usage (11-REQ-30); — without checks or in a v1 report. */
function headroomCell(ctx: Ctx, agg: HtmlAggregate): SafeHtml {
  const top = ctx.migrated ? undefined : topCheck(agg.evaluation.checks);
  if (top === undefined) return html`<td class="z">${DASH}</td>`;
  return html`<td>${usageMeter(top)}</td>`;
}

/** Samples cell with the statuses of a key without timed samples (F2 decision 6). */
function samplesCell(ctx: Ctx, kind: LinkKind, agg: HtmlAggregate): SafeHtml {
  const note = notTimedNote(ctx, kind, agg);
  return html`<td class="num">${agg.successCount} / ${agg.count}${note === null ? null : html`<small class="why">${note}</small>`}</td>`;
}

function keyRow(
  ctx: Ctx,
  kind: LinkKind,
  key: string,
  agg: HtmlAggregate,
  columns: number,
  ttfb: boolean,
): SafeHtml {
  const ev = agg.evaluation;
  const s = agg.stats;
  const id = keyAnchor(ctx, kind, key) ?? '';
  const group = rowGroup(ev);
  const reason = reasonText(ev.reason);
  const muted = ev.muted !== null && !ev.muted.expired;
  return join(
    html`<tbody data-g="${group}" data-s="${ev.thresholdSource}"${muted ? html` data-m=""` : null}><tr class="${rowClass(ev)}">`,
    html`<th scope="row" class="k">${kind === 'step' ? stepDepth(key) : null}${keyLink(ctx, kind, key)}</th>`,
    kind === 'api' ? html`<td class="es">${endpointSource(key)}</td>` : null,
    html`<td class="r">${resultPill(ev)}${sourceToken(ev.thresholdSource)}${mutedPill(ev.muted)}`,
    reason === null ? null : html`<small class="why">${reason}</small>`,
    html`</td>`,
    headroomCell(ctx, agg),
    samplesCell(ctx, kind, agg),
    agg.errorCount === 0
      ? html`<td class="num"></td>`
      : html`<td class="num e">${agg.errorCount}</td>`,
    timeCell(s?.percentiles['p50']),
    s === null
      ? timeCell(undefined)
      : limitCell(
          s.percentiles[ctx.level],
          evaluatedLimit(agg, 'percentile', ev.limits.percentile),
        ),
    s === null
      ? timeCell(undefined)
      : limitCell(s.percentiles['p99'], evaluatedLimit(agg, 'p99', ev.limits.p99)),
    timeCell(s?.max),
    ttfb ? timeCell(agg.ttfb?.p50) : null,
    kind === 'step' ? html`<td class="loc">${locationText(agg)}</td>` : null,
    html`<td class="num">${agg.testCount}</td></tr>`,
    html`<tr class="drow"><td colspan="${columns}"><details id="${id}"${group <= 1 ? html` data-v=""` : null}>`,
    html`<summary>Details</summary>`,
    keyDetails(ctx, kind, key, agg),
    html`</details></td></tr></tbody>`,
  );
}

function chip(group: string, value: string, label: HtmlValue): SafeHtml {
  return html`<button type="button" class="flt" aria-pressed="false" data-f="${group}" data-v="${value}">${label}</button>`;
}

/** Search box of a table toolbar (11-REQ-54). */
export function searchBox(label: string, placeholder: string): SafeHtml {
  return html`<label class="search">${icon('search')}<input type="search" aria-label="${label}" placeholder="${placeholder}" autocomplete="off"></label>`;
}

/** Search, filter chips, reset and counter of a key table (11-REQ-13); shown by the script. */
function keyFilters(kind: LinkKind, total: number): SafeHtml {
  return join(
    html`<div class="toolbar js-only" hidden>`,
    searchBox('Search keys', kind === 'step' ? 'Filter steps…' : 'Filter endpoints…'),
    html`<div class="fg" role="group" aria-label="Result"><span aria-hidden="true">Result</span>${[
      chip('g', '0', 'blocking'),
      chip('g', '1', 'violation'),
      chip('g', '2', 'pass'),
      chip('g', '3', 'not evaluated'),
    ]}</div>`,
    html`<div class="fg" role="group" aria-label="Thresholds"><span aria-hidden="true">Thresholds</span>${[chip('s', 'file', 'file'), chip('s', 'default', 'default')]}</div>`,
    html`<div class="fg" role="group" aria-label="Muted">${chip('m', '', html`${icon('mute')}muted`)}</div>`,
    html`<button type="button" class="btn sm" data-reset>Reset</button>`,
    html`<span class="count" role="status" data-count>showing ${total} of ${total}</span></div>`,
  );
}

/** Empty state of a table after filtering (11-REQ-58), shown by the script. */
export function noMatch(text: string): SafeHtml {
  return html`<div class="empty sm" data-none hidden>${icon('search')}<p>${text}</p><button type="button" class="btn sm" data-reset>Reset</button></div>`;
}

/** The key table of one kind (11, chapter 6.4). */
export function keyTable(ctx: Ctx, kind: LinkKind, title: string): SafeHtml {
  const aggregates = aggregatesOf(ctx.data, kind);
  const keys = ctx.order[kind];
  // No TTFB column when no key has TTFB, e.g. only request calls (F2 decision 27).
  const ttfb = kind === 'api' && keys.some((key) => aggregates[key]?.ttfb != null);
  const cols: [column: string, label: string][] = [
    ['key', 'Key'],
    // Browser traffic or APIRequestContext calls (15-REQ-15).
    ...(kind === 'api' ? [['source', 'Source'] as [string, string]] : []),
    ['result', 'Result'],
    ['headroom', 'Limit used'],
    ['samples', 'Samples'],
    ['errors', 'Errors'],
    ['p50', 'p50'],
    ['percentile', `${ctx.level} / limit`],
    ['p99', 'p99 / limit'],
    ['max', 'Max'],
    ...(ttfb ? [['ttfb', 'TTFB p50'] as [string, string]] : []),
    ...(kind === 'step' ? [['defined', 'Defined at'] as [string, string]] : []),
    ['tests', 'Tests'],
  ];
  const numeric = new Set([
    'samples',
    'errors',
    'p50',
    'percentile',
    'p99',
    'max',
    'ttfb',
    'tests',
  ]);
  // `/ —`: a rule without a check, e.g. fewer samples than its minSamples (09-REQ-07).
  const notEvaluated = keys.some((key) => {
    const agg = aggregates[key];
    if (agg?.stats == null) return false;
    const rules = new Set(agg.evaluation.checks.map((c) => c.rule));
    return !rules.has('percentile') || !rules.has('p99');
  });
  const notes = [
    'All times in ms',
    'the tick on each limit used bar marks the limit',
    `${ctx.level} is the evaluated percentile`,
    notEvaluated ? '/ — : rule not evaluated (too few samples or rule off)' : null,
    kind === 'step' ? 'step keys are title paths joined with ›' : null,
  ].filter((n) => n !== null);
  return join(
    html`<div class="card" data-for="table-${kind}">`,
    keyFilters(kind, keys.length),
    html`<div class="scroll" tabindex="0" role="region" aria-label="${title} table"><table class="keys" id="table-${kind}" data-kind="${kind}" data-level="${ctx.level}">`,
    html`<caption>${title}: ${plural(keys.length, 'key')}, violations first</caption>`,
    html`<thead><tr>${cols.map(([column, label]) =>
      // The location is text, not a number to sort by (11-REQ-47).
      column === 'defined'
        ? html`<th scope="col">${label}</th>`
        : html`<th scope="col" data-sort="${column}"${numeric.has(column) ? html` class="num"` : null}><button type="button">${label}</button></th>`,
    )}</tr></thead>`,
    keys.map((key) => keyRow(ctx, kind, key, aggregates[key] as HtmlAggregate, cols.length, ttfb)),
    html`</table></div>`,
    noMatch('No keys match the filters'),
    html`<p class="tfoot">${notes.join(' · ')}</p></div>`,
  );
}

/** Keys of a ranking or list shortened to this many code points (narrow columns). */
export const LIST_KEY_MAX = 56;
