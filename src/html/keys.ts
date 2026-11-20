// Key tables and key details (11, chapters 6.4–6.9): one row per key in the default order
// (11-REQ-09) and its details block, a <details> under the row that the script shows in the
// drawer (11-REQ-37).
import type { Check, KeyEvaluation, RunReport } from '../core/types/index.ts';
import { percentileBar } from './bar.ts';
import { histogramSvg, ttfbSplitSvg } from './charts.ts';
import type { Mark } from './charts.ts';
import { DASH, KIND_LABEL, isBlocking, join, keyAnchor, rowGroup, topCheck } from './context.ts';
import type { Ctx, LinkKind } from './context.ts';
import type { HtmlAggregate } from './data.ts';
import { html } from './escape.ts';
import type { HtmlValue, SafeHtml } from './escape.ts';
import { formatDate, formatMs, formatRatio, plural, truncateMiddle, usageText } from './format.ts';
import { hintText, ruleLabel } from './hints.ts';

/** Keys longer than this are shortened in the middle in tables and lists (11, chapter 6.4). */
export const KEY_COLUMN_MAX = 80;

/**
 * Checks of a key show a meter from this usage on (the `low` mark of the meter); checks far from
 * their limit show the text only. This keeps the reference report under 5 MB (NF-08, 11-REQ-43);
 * the key's own headroom always has a meter in the table.
 */
const NEAR_LIMIT = 0.8;

const TIME_RULES: ReadonlySet<Check['rule']> = new Set<Check['rule']>([
  'median',
  'percentile',
  'p99',
]);

// ---------------------------------------------------------------------------------------------
// Pills (11-REQ-41): text and shape; colour only reinforces them

export function pill(cls: string, text: HtmlValue): SafeHtml {
  return html`<span class="p ${cls}">${text}</span>`;
}

export function resultPill(evaluation: KeyEvaluation): SafeHtml {
  if (evaluation.result === 'fail') {
    return isBlocking(evaluation) ? pill('p-block', 'fail · blocking') : pill('p-fail', 'fail');
  }
  return evaluation.result === 'pass' ? pill('p-pass', 'pass') : pill('p-ne', 'not evaluated');
}

export function mutedPill(muted: KeyEvaluation['muted']): SafeHtml | null {
  if (muted === null) return null;
  const until = muted.until.slice(0, 10);
  return muted.expired ? pill('p-exp', 'mute expired') : pill('p-mute', `muted until ${until}`);
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

/**
 * `<meter>` of a usage with its text (11-REQ-30, 11-D-20). The meter is inside a <label> with
 * the text, which gives it its accessible name with less markup than an id reference.
 */
export function usageMeter(usage: number | null, text: string): SafeHtml {
  const value = usage === null ? 1.25 : Math.min(usage, 1.25);
  return html`<label><meter max="1.25" low="0.8" high="1" optimum="0" value="${value}"></meter> ${text}</label>`;
}

// ---------------------------------------------------------------------------------------------
// Key details (11, chapter 6.5)

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

function checkValue(check: Check, value: number): string {
  return TIME_RULES.has(check.rule) ? formatMs(value) : formatRatio(value);
}

function checksTable(ctx: Ctx, agg: HtmlAggregate): SafeHtml {
  const ev = agg.evaluation;
  if (ev.result === 'not-evaluated') {
    const reason = reasonText(ev.reason);
    const lowest = lowestMinSamples(ctx.report, ctx.level);
    return join(
      html`<p>Not evaluated${reason === null ? '' : `: ${reason}`}.`,
      lowest === null
        ? null
        : ` The lowest rule (${lowest.rule}) needs ${plural(lowest.n, 'sample')}; this key has ${String(agg.successCount)} successful of ${plural(agg.count, 'sample')}.`,
      html`</p>`,
    );
  }
  const row = (c: Check): SafeHtml => {
    const notes = [c.blocking ? 'blocking' : null, c.hardLimitExceeded ? 'hard limit' : null]
      .filter((n) => n !== null)
      .join(' · ');
    return join(
      html`<tr><th scope="row">${ruleLabel(c.rule, ctx.level)}</th><td>${c.n}</td>`,
      html`<td>${checkValue(c, c.actual)}</td><td>${c.observed === null ? null : formatRatio(c.observed)}</td>`,
      html`<td>${checkValue(c, c.limit)}</td><td>`,
      ctx.migrated
        ? DASH
        : c.usage === null || c.usage >= NEAR_LIMIT
          ? usageMeter(c.usage, usageText(c.usage, !c.passed, true))
          : usageText(c.usage, false, true),
      html`</td><td>${c.passed ? 'pass' : 'fail'}${notes === '' ? '' : ` · ${notes}`}</td></tr>`,
    );
  };
  return join(
    html`<table class="ck"><caption>Checks</caption><thead><tr>`,
    html`<th>Rule</th><th>n</th><th>Value</th><th>Observed</th>`,
    html`<th>Limit</th><th>Headroom</th><th>Result</th></tr></thead>`,
    html`<tbody>${ev.checks.map(row)}</tbody></table>`,
  );
}

function testRef(t: { title: string; project: string; file: string; line: number }): SafeHtml {
  const project = t.project === '' ? 'default project' : t.project;
  return html`${t.title} · ${project} · ${t.file}:${t.line}`;
}

/** One fact of a key: label and value in a line of the facts paragraph. */
function fact(label: string, value: HtmlValue): SafeHtml {
  return html`<span>${label}: ${value}</span> `;
}

/** Histogram (11-REQ-32), the percentile bar of a migrated report (11-REQ-11) or a message. */
function distribution(ctx: Ctx, agg: HtmlAggregate): SafeHtml {
  const stats = agg.stats;
  if (stats === null) return html`<p>No successful timed samples.</p>`;
  if (agg.histogram === null) {
    return percentileBar(stats, agg.evaluation.limits, ctx.level) ?? html`<p>${DASH}</p>`;
  }
  const markers: Mark[] = [];
  for (const name of ['p50', ctx.level, 'p99']) {
    const value = stats.percentiles[name];
    if (value !== undefined && !markers.some((m) => m.label === name)) {
      markers.push({ label: name, value });
    }
  }
  const limit = agg.evaluation.limits.percentile;
  return histogramSvg({
    edges: agg.histogram.edges,
    counts: agg.histogram.counts,
    markers,
    limit: { label: 'limit', value: limit, limit: true },
    retained: agg.samples.retained,
    sampled: agg.samples.sampled,
  });
}

/** TTFB split of an endpoint (11-REQ-33). */
function ttfbSplit(agg: HtmlAggregate): SafeHtml | null {
  const ttfb = agg.ttfb;
  if (ttfb === null || ttfb.otherP50 === null || agg.stats === null) return null;
  const svg = ttfbSplitSvg(ttfb.p50, ttfb.otherP50);
  if (svg === null) return null;
  const sum = Math.round((ttfb.p50 + ttfb.otherP50) * 10) / 10;
  return join(
    svg,
    html`<p class="lg"><span class="sw st"></span>Server wait (TTFB p50) ${formatMs(ttfb.p50)} <span class="sw so"></span>Rest (p50 of duration − TTFB) ${formatMs(ttfb.otherP50)}</p>`,
    html`<p class="mu">Medians of each part: their sum (${formatMs(sum)}) can differ from p50 of the duration (${formatMs(agg.stats.percentiles['p50'] ?? 0)}).</p>`,
  );
}

function keyHeader(key: string, agg: HtmlAggregate, kind: LinkKind): SafeHtml {
  const ev = agg.evaluation;
  return join(
    html`<p class="kh"><code class="fk">${key}</code><br>`,
    pill('p-kind', KIND_LABEL[kind]),
    resultPill(ev),
    pill('p-src', ev.thresholdSource),
    mutedPill(ev.muted),
    html`</p>`,
  );
}

/** Content of the details block of a key; `id` is its anchor (11-REQ-37). */
export function keyDetails(ctx: Ctx, kind: LinkKind, key: string, agg: HtmlAggregate): SafeHtml {
  const statuses = Object.keys(agg.statuses).sort();
  const statusList = statuses.map(
    (s, i) => html`${i > 0 ? ', ' : ''}${s} → ${agg.statuses[s] ?? 0}`,
  );
  const hints = ctx.migrated ? [] : agg.hints;
  return join(
    html`<div class="kd">`,
    keyHeader(key, agg, kind),
    hints.length === 0
      ? null
      : html`<ul class="hints">${hints.map((h) => html`<li>${hintText(h, ctx.level, agg.evaluation.muted)}</li>`)}</ul>`,
    checksTable(ctx, agg),
    distribution(ctx, agg),
    kind === 'api' ? ttfbSplit(agg) : null,
    html`<p class="facts">`,
    fact('Statuses', statuses.length === 0 ? DASH : statusList),
    fact('From failed tests', agg.fromFailedTests),
    agg.timeSources.node > 0
      ? fact(
          'Time sources',
          `browser ${String(agg.timeSources.browser)}, node ${String(agg.timeSources.node)}`,
        )
      : null,
    kind === 'api'
      ? fact(
          'TTFB',
          agg.ttfb === null ? DASH : `p50 ${formatMs(agg.ttfb.p50)}, p95 ${formatMs(agg.ttfb.p95)}`,
        )
      : null,
    fact(
      'Retained samples',
      agg.samples.sampled
        ? `${String(agg.samples.retained)} (uniform sample of ${String(agg.successCount)}; the histogram shows them)`
        : `${String(agg.samples.retained)} (all successful)`,
    ),
    html`</p>`,
    agg.slowest.length === 0
      ? null
      : html`<h4>Slowest samples</h4><ol class="ls">${agg.slowest.map((s) =>
          join(
            html`<li><b>${formatMs(s.duration)}</b> ${formatDate(s.startedAt)} · `,
            html`${testRef(s.test)} · repeat ${s.test.repeatEachIndex}`,
            s.url === undefined ? null : html`<br><span class="url">${s.url}</span>`,
            html`</li>`,
          ),
        )}</ol>`,
    agg.topTests.length === 0
      ? null
      : html`<h4>Top tests</h4><ol class="ls">${agg.topTests.map(
          (t) =>
            html`<li>${t.title} · ${t.file}:${t.line} · ${plural(t.sampleCount, 'sample')}</li>`,
        )}</ol>`,
    html`</div>`,
  );
}

// ---------------------------------------------------------------------------------------------
// Key table (11, chapter 6.4)

function percentileCell(value: number | undefined, limit: number): HtmlValue {
  return value === undefined ? DASH : html`${formatMs(value)}<small> / ${formatMs(limit)}</small>`;
}

/** Headroom cell: the key's largest usage (11-REQ-30); — without checks or in a v1 report. */
function headroomCell(ctx: Ctx, agg: HtmlAggregate): HtmlValue {
  const top = ctx.migrated ? undefined : topCheck(agg.evaluation.checks);
  if (top === undefined) return DASH;
  return usageMeter(top.usage, usageText(top.usage, !top.passed));
}

function keyRow(
  ctx: Ctx,
  kind: LinkKind,
  key: string,
  agg: HtmlAggregate,
  columns: number,
): SafeHtml {
  const ev = agg.evaluation;
  const s = agg.stats;
  const id = keyAnchor(ctx, kind, key) ?? '';
  const group = rowGroup(ev);
  const short = truncateMiddle(key, KEY_COLUMN_MAX);
  const reason = reasonText(ev.reason);
  const time = (value: number | undefined): HtmlValue =>
    value === undefined ? DASH : formatMs(value);
  const muted = ev.muted !== null && !ev.muted.expired;
  return join(
    html`<tbody data-g="${group}" data-s="${ev.thresholdSource}"${muted ? html` data-m=""` : null}><tr>`,
    html`<th scope="row"><a href="#${id}"${short === key ? null : html` title="${key}"`}>${short}</a></th>`,
    html`<td>${resultPill(ev)}`,
    pill('p-src', ev.thresholdSource),
    mutedPill(ev.muted),
    reason === null ? null : html`<br><small>${reason}</small>`,
    html`</td><td>${headroomCell(ctx, agg)}</td>`,
    html`<td>${agg.successCount} / ${agg.count}</td><td>${agg.errorCount === 0 ? null : agg.errorCount}</td>`,
    html`<td>${time(s?.percentiles['p50'])}</td>`,
    html`<td>${s === null ? DASH : percentileCell(s.percentiles[ctx.level], ev.limits.percentile)}</td>`,
    html`<td>${s === null ? DASH : percentileCell(s.percentiles['p99'], ev.limits.p99)}</td>`,
    html`<td>${time(s?.max)}</td>`,
    kind === 'api' ? html`<td>${time(agg.ttfb?.p50)}</td>` : null,
    html`<td>${agg.testCount}</td></tr>`,
    html`<tr class="drow"><td colspan="${columns}"><details id="${id}"${group <= 1 ? html` data-v=""` : null}>`,
    html`<summary>Details</summary>`,
    keyDetails(ctx, kind, key, agg),
    html`</details></td></tr></tbody>`,
  );
}

function chip(group: string, value: string, label: string): SafeHtml {
  return html`<button type="button" class="chip" aria-pressed="false" data-f="${group}" data-v="${value}">${label}</button>`;
}

/** Search, filter chips and the counter of a key table (11-REQ-13); shown by the script. */
function keyFilters(kind: LinkKind, total: number): SafeHtml {
  return join(
    html`<div class="tools js-only" data-for="table-${kind}" hidden>`,
    html`<input type="search" class="search" aria-label="Search keys" placeholder="Search keys" autocomplete="off">`,
    html`<div class="chips" role="group" aria-label="Result">${[
      chip('g', '0', 'blocking'),
      chip('g', '1', 'violation'),
      chip('g', '2', 'pass'),
      chip('g', '3', 'not evaluated'),
    ]}</div>`,
    html`<div class="chips" role="group" aria-label="Thresholds">${[chip('s', 'file', 'file'), chip('s', 'default', 'default')]}</div>`,
    html`<div class="chips" role="group" aria-label="Muted">${chip('m', '', 'muted')}</div>`,
    html`<button type="button" class="btn" data-reset>Reset</button>`,
    html`<span class="count" role="status" data-count>showing ${total} of ${total}</span></div>`,
  );
}

/** The key table of one kind (11, chapter 6.4). */
export function keyTable(ctx: Ctx, kind: LinkKind, title: string): SafeHtml {
  const aggregates = kind === 'api' ? ctx.data.endpoints : ctx.data.custom;
  const keys = ctx.order[kind];
  const cols: [column: string, label: string][] = [
    ['key', 'Key'],
    ['result', 'Result'],
    ['headroom', 'Headroom'],
    ['samples', 'Samples'],
    ['errors', 'Errors'],
    ['p50', 'p50'],
    ['percentile', `${ctx.level} / limit`],
    ['p99', 'p99 / limit'],
    ['max', 'Max'],
    ...(kind === 'api' ? [['ttfb', 'TTFB p50'] as [string, string]] : []),
    ['tests', 'Tests'],
  ];
  return join(
    keyFilters(kind, keys.length),
    html`<div class="scroll"><table class="keys" id="table-${kind}" data-kind="${kind}" data-level="${ctx.level}">`,
    html`<caption>${title}: ${plural(keys.length, 'key')}, violations first</caption>`,
    html`<thead><tr>${cols.map(([column, label]) => html`<th scope="col" data-sort="${column}"><button type="button">${label}</button></th>`)}</tr></thead>`,
    keys.map((key) => keyRow(ctx, kind, key, aggregates[key] as HtmlAggregate, cols.length)),
    html`</table></div>`,
  );
}
