// Verdict card, KPI strip and the Overview tab (11, chapters 6.2, 6.3 and 8a).
import type { RunReport } from '../core/types/index.ts';
import {
  DASH,
  KIND_COLUMN,
  KIND_NAME,
  KIND_ORDER,
  LINK_KINDS,
  aggregatesOf,
  compareText,
  join,
  keyLink,
  limitRatio,
  rowGroup,
  topCheck,
} from './context.ts';
import type { Ctx, LinkKind } from './context.ts';
import type { HtmlAggregate } from './data.ts';
import { html } from './escape.ts';
import type { HtmlValue, SafeHtml } from './escape.ts';
import {
  formatMs,
  formatPercent,
  formatRunDuration,
  plural,
  truncateMiddle,
  usagePercent,
} from './format.ts';
import { hintText, ruleLabel } from './hints.ts';
import { icon } from './icons.ts';
import type { IconName } from './icons.ts';
import {
  LIST_KEY_MAX,
  NEAR_LIMIT,
  checkValue,
  kindToken,
  mutedPill,
  pill,
  resultPill,
  sourceToken,
  usageMeter,
} from './keys.ts';

/** Entries of each ranking (11-REQ-31) and of the violations list (11-REQ-29). */
const RANKING_SIZE = 10;
const EXPENSIVE_TESTS = 5;
/** Pips of the Passes field (11-REQ-28). */
const MAX_PIPS = 10;

export type BannerStatus = 'ERROR' | 'FAILED' | 'PASSED WITH WARNINGS' | 'PASSED';

export interface Banner {
  status: BannerStatus;
  sentence: string;
  /** Exit code of the run (00, chapter 11): ERROR 3, FAILED 2, otherwise 0. */
  exitCode: 0 | 2 | 3;
  /** Every evaluated key used default thresholds (11, chapter 12): the info box. */
  defaultsOnly: boolean;
}

function sum(report: RunReport, field: keyof RunReport['evaluation']['counts']['api']): number {
  return LINK_KINDS.reduce((total, kind) => total + report.evaluation.counts[kind][field], 0);
}

/** Failed checks that block, over all keys. */
function blockingChecks(report: RunReport): number {
  let n = 0;
  for (const kind of [report.endpoints, report.steps]) {
    for (const agg of Object.values(kind)) {
      n += agg.evaluation.checks.filter((c) => !c.passed && c.blocking).length;
    }
  }
  return n;
}

/** Status and sentence of the verdict card: the first matching row of 11-REQ-27. */
export function banner(report: RunReport): Banner {
  const ev = report.evaluation;
  const errors = report.toolErrors;
  const result = (status: BannerStatus, sentence: string, defaultsOnly = false): Banner => ({
    status,
    sentence,
    exitCode: status === 'ERROR' ? 3 : status === 'FAILED' ? 2 : 0,
    defaultsOnly,
  });
  if (errors.length > 0 || ev.status === 'error') {
    const first = errors[0];
    return result(
      'ERROR',
      first === undefined
        ? 'Evaluation could not run.'
        : `The tool reported ${plural(errors.length, 'error')}: ${first.code} — ${first.message}`,
    );
  }
  const violations = sum(report, 'violations');
  if (ev.status === 'failed' && ev.gateEnabled && report.mode === 'test') {
    return result(
      'FAILED',
      `${plural(blockingChecks(report), 'blocking violation')} in ${plural(sum(report, 'blockingViolations'), 'key')}: the run fails.`,
    );
  }
  if (ev.status === 'warned') {
    return result('PASSED WITH WARNINGS', `${plural(violations, 'violation')}, none blocking.`);
  }
  if (ev.status === 'failed') {
    return result(
      'PASSED WITH WARNINGS',
      `Gate off (thresholds mode): ${plural(violations, 'violation')} would fail a test run.`,
    );
  }
  if (report.warnings.length > 0) {
    return result(
      'PASSED WITH WARNINGS',
      `No violations; ${plural(report.warnings.length, 'warning')} to review.`,
    );
  }
  if (report.tests.status !== 'passed') {
    const failed = report.tests.unexpected;
    return result(
      'PASSED WITH WARNINGS',
      failed > 0
        ? `${plural(failed, 'test execution')} failed; results may be incomplete.`
        : `The tests ${report.tests.status === 'timedout' ? 'timed out' : report.tests.status}; results may be incomplete.`,
    );
  }
  const evaluated = sum(report, 'fromFile') + sum(report, 'fromDefaults');
  if (evaluated === 0) {
    return result('PASSED', 'No key was evaluated (too few samples or no applicable rules).');
  }
  const defaultsOnly =
    sum(report, 'fromFile') === 0 && !report.thresholdFiles.some((f) => f.status === 'loaded');
  return result(
    'PASSED',
    `All ${String(evaluated)} evaluated keys are within their limits.`,
    defaultsOnly,
  );
}

/** Tone of the verdict card (11-REQ-27): ERROR is a tool error, neutral dark, not red. */
const TONE: Record<BannerStatus, string> = {
  ERROR: 't-err',
  FAILED: 't-bad',
  'PASSED WITH WARNINGS': 't-warn',
  PASSED: 't-ok',
};
const TONE_ICON: Record<BannerStatus, IconName> = {
  ERROR: 'warn',
  FAILED: 'bad',
  'PASSED WITH WARNINGS': 'warn',
  PASSED: 'ok',
};

/** One result of the detailed verdict (11-REQ-08): label, dot, bold word and muted details. */
function result(label: string, dot: string, word: string, details: HtmlValue): SafeHtml {
  return html`<div class="ss"><dt>${label}</dt><dd><span class="dot ${dot}"></span>${word}${details === null || details === '' ? null : html` <span class="sub">${details}</span>`}</dd></div>`;
}

/** The three results of 11-REQ-08 in the right part of the verdict card. */
function verdictResults(report: RunReport): SafeHtml {
  const t = report.tests;
  const untrustworthy = report.toolErrors.some((i) => i.code === 'TESTS_FAILED_TOO_MANY');
  const testParts = [
    plural(t.expected + t.unexpected + t.flaky, 'test'),
    t.unexpected > 0 ? `${String(t.unexpected)} failed` : null,
    t.flaky > 0 ? `${String(t.flaky)} flaky` : null,
    t.skipped > 0 ? `${String(t.skipped)} skipped` : null,
    untrustworthy ? 'too many failed: result not trustworthy' : null,
  ].filter((p) => p !== null);
  const perf = report.evaluation.status;
  const blocking = sum(report, 'blockingViolations');
  const muted = sum(report, 'muted');
  const perfParts = [
    blocking > 0 ? `${String(blocking)} blocking` : null,
    muted > 0 ? `${String(muted)} muted` : null,
    report.evaluation.gateEnabled ? null : 'gate off (thresholds mode)',
  ].filter((p) => p !== null);
  const errors = report.toolErrors.length;
  return html`<dl class="subst">${[
    result(
      'Performance',
      perf === 'passed' ? 'd-ok' : perf === 'warned' ? 'd-warn' : 'd-bad',
      perf,
      perfParts.join(' · '),
    ),
    result(
      'Tests',
      t.status === 'passed' ? 'd-ok' : 'd-warn',
      t.status === 'timedout' ? 'timed out' : t.status,
      testParts.join(' · '),
    ),
    result(
      'Tool errors',
      errors === 0 ? 'd-ok' : 'd-bad',
      errors === 0 ? 'none' : String(errors),
      null,
    ),
  ]}</dl>`;
}

/** The verdict card (11-REQ-27) with the detailed verdict (11-REQ-08). */
export function verdictCard(ctx: Ctx): SafeHtml {
  const v = banner(ctx.report);
  const tool = ctx.report.tool;
  const muted = sum(ctx.report, 'muted');
  const extra = [
    muted > 0 ? `${plural(muted, 'key')} muted` : null,
    `exit code ${String(v.exitCode)}`,
  ].filter((p) => p !== null);
  return join(
    html`<section class="hero ${TONE[v.status]}" aria-labelledby="vh"><div class="verdict"><span class="v-ic">${icon(TONE_ICON[v.status])}</span><div>`,
    html`<p class="eyebrow">Run verdict</p><h1 class="status" id="vh">${v.status}${ctx.report.evaluation.gateEnabled ? null : html` ${pill('', 'gate off')}`}</h1>`,
    html`<p class="summary">${v.sentence}<span class="sub">${extra.join(' · ')}</span></p>`,
    ctx.migrated
      ? html`<p class="sub">Report format v1 (${tool.name} v${tool.version}): per-test data, histograms, headroom and hints are not available.</p>`
      : null,
    v.defaultsOnly && v.status === 'PASSED'
      ? html`<p class="note">${icon('info')}<span>Evaluated with default thresholds only; run your test command with <code>PW_PERF_MODE=thresholds</code> to create thresholds files.</span></p>`
      : null,
    html`</div></div>`,
    verdictResults(ctx.report),
    html`</section>`,
  );
}

// ---------------------------------------------------------------------------------------------
// KPI strip (11-REQ-28)

/** Width class of a share, 0–100 in steps of 5 (11-REQ-55). */
export function widthClass(share: number): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0));
  return `w-${String(Math.round(clamped * 20) * 5)}`;
}

function field(
  label: string,
  value: HtmlValue,
  note: string,
  viz: SafeHtml | null = null,
  cls = '',
): SafeHtml {
  return html`<div class="kpi${cls}"><dt>${label}</dt><dd class="kv">${value}</dd>${viz === null ? null : html`<dd class="viz">${viz}</dd>`}<dd class="ks">${note}</dd></div>`;
}

/** `6<small>min</small> 42<small>s</small>`: numbers large, units small. */
function durationValue(text: string): SafeHtml {
  if (text === DASH) return html`${DASH}`;
  const parts = text.split(' ');
  return html`${parts.map((p, i) => (i % 2 === 0 ? html`${i > 0 ? ' ' : ''}${p}` : html`<small> ${p}</small>`))}`;
}

/** `HH:mm` of an ISO time in UTC. */
function clock(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return DASH;
  const d = new Date(time);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Keys of a kind that pass with a headroom of at least 0.9 (Steps field). */
function nearLimit(data: Record<string, HtmlAggregate>): number {
  return Object.values(data).filter((a) => {
    if (a.evaluation.result !== 'pass') return false;
    const usage = topCheck(a.evaluation.checks)?.usage;
    return usage !== undefined && usage !== null && usage >= NEAR_LIMIT;
  }).length;
}

export function kpis(ctx: Ctx): SafeHtml {
  const r = ctx.report;
  const counts = r.evaluation.counts;
  const endpoints = Object.values(r.endpoints);
  const steps = Object.keys(r.steps).length;
  const requests = endpoints.reduce((n, a) => n + a.count, 0);
  const failedRequests = endpoints.reduce((n, a) => n + a.errorCount, 0);
  const measured = r.runConditions.projects.filter((p) => p.role === 'measured');
  const passes = r.passes;
  const t = r.tests;
  const violations = sum(r, 'violations');
  const blocking = sum(r, 'blockingViolations');
  const muted = sum(r, 'muted');
  const other = Math.max(0, violations - blocking - muted);
  const share = (n: number) => widthClass(violations === 0 ? 0 : n / violations);
  const split =
    violations === 0
      ? null
      : html`<span class="vsplit" aria-hidden="true">${[
          blocking > 0 ? html`<span class="s-bad ${share(blocking)}"></span>` : null,
          other > 0 ? html`<span class="s-warn ${share(other)}"></span>` : null,
          muted > 0 ? html`<span class="s-mute ${share(muted)}"></span>` : null,
        ]}</span>`;
  const rate = requests === 0 ? 0 : failedRequests / requests;
  const ring =
    requests === 0
      ? null
      : html`<svg class="ring" viewBox="0 0 36 36" aria-hidden="true"><circle class="tr" cx="18" cy="18" r="14"/>${
          failedRequests === 0
            ? null
            : html`<circle class="vl" cx="18" cy="18" r="14" pathLength="100" stroke-dasharray="${Math.max(1, Math.round(rate * 1000) / 10)} 100"/>`
        }</svg>`;
  const pips = html`<span class="pips" aria-hidden="true">${Array.from(
    { length: Math.min(MAX_PIPS, passes.planned) },
    (_, i) => html`<span${passes.failed.includes(i + 1) ? html` class="off"` : null}></span>`,
  )}</span>`;
  return join(
    html`<dl class="kpis" aria-label="Key figures">`,
    field(
      'Endpoints',
      endpoints.length,
      `${String(counts.api.fromFile + counts.api.fromDefaults)} evaluated · ${String(counts.api.tooFewSamples)} too few`,
    ),
    // Steps when the report has step keys, otherwise Tests (11-REQ-28).
    steps > 0
      ? field('Steps', steps, `${String(nearLimit(ctx.data.steps))} near limit`)
      : field(
          'Tests',
          t.expected + t.unexpected + t.flaky,
          `${String(t.unexpected)} failed · ${String(t.flaky)} flaky · ${String(t.skipped)} skipped`,
        ),
    field(
      'Violations',
      violations,
      `${String(blocking)} blocking · ${String(muted)} muted`,
      split,
      violations > 0 ? ' bad' : '',
    ),
    field(
      'Error rate',
      requests === 0 ? DASH : html`${formatPercent(rate).slice(0, -1)}<small>%</small>`,
      `${String(failedRequests)} of ${plural(requests, 'request')}`,
      ring,
    ),
    field(
      'Duration',
      durationValue(formatRunDuration(r.startedAt, r.finishedAt)),
      `${clock(r.startedAt)} → ${clock(r.finishedAt)} UTC`,
    ),
    // Passes of the run (D-39); "4 of 5" when a pass gave no data.
    field(
      'Passes',
      passes.completed === passes.planned
        ? html`${passes.completed}<small>×</small>`
        : html`${passes.completed}<small> of ${passes.planned}</small>`,
      plural(measured.length, 'measured project'),
      pips,
    ),
    html`</dl>`,
  );
}

// ---------------------------------------------------------------------------------------------
// Violations, rankings, expensive tests, muted keys, counts (11-REQ-29)

interface Entry {
  kind: LinkKind;
  key: string;
  agg: HtmlAggregate;
}

function entries(ctx: Ctx): Entry[] {
  return LINK_KINDS.flatMap((kind) =>
    ctx.order[kind].map((key) => ({
      kind,
      key,
      agg: aggregatesOf(ctx.data, kind)[key] as HtmlAggregate,
    })),
  );
}

function byKindThenKey(a: Entry, b: Entry): number {
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || compareText(a.key, b.key);
}

/** A section heading of a panel with an optional count badge and a "more" link (11-REQ-51). */
function heading(id: string, title: string, badge: SafeHtml | null, more: SafeHtml | null) {
  return html`<div class="ph"><h3 id="${id}">${title}${badge === null ? null : html` ${badge}`}</h3>${more}</div>`;
}

export function badge(n: number, tone = ''): SafeHtml {
  return html`<span class="n${tone === '' ? '' : ` ${tone}`}">${n}</span>`;
}

/** A violation card (11-REQ-52). */
function violationCard(ctx: Ctx, e: Entry): SafeHtml {
  const ev = e.agg.evaluation;
  const top = topCheck(ev.checks.filter((c) => !c.passed)) ?? topCheck(ev.checks);
  const hint = ctx.migrated ? undefined : e.agg.hints[0];
  const muted = ev.muted !== null && !ev.muted.expired;
  return join(
    html`<article class="card vio${muted ? ' mu' : ''}"><p class="top">${resultPill(ev)}${mutedPill(ev.muted)}${kindToken(e.kind)}${sourceToken(ev.thresholdSource)}</p>`,
    keyLink(ctx, e.kind, e.key),
    top === undefined
      ? null
      : html`<p class="rule"><span>${ruleLabel(top.rule, ctx.level)} <b>${checkValue(top, top.actual)}</b> · limit ${checkValue(top, top.limit)}</span>${ctx.migrated ? null : usageMeter(top.usage, !top.passed)}</p>`,
    hint === undefined
      ? null
      : html`<p class="hint">${icon('bulb')}<span>${hintText(hint, ctx.level, ev.muted)}</span></p>`,
    html`</article>`,
  );
}

function violations(ctx: Ctx): SafeHtml | null {
  const failed = entries(ctx)
    .filter((e) => e.agg.evaluation.result === 'fail')
    .sort(
      (a, b) =>
        rowGroup(a.agg.evaluation) - rowGroup(b.agg.evaluation) ||
        (limitRatio(b.agg, ctx.level) > limitRatio(a.agg, ctx.level)
          ? 1
          : limitRatio(b.agg, ctx.level) < limitRatio(a.agg, ctx.level)
            ? -1
            : 0) ||
        byKindThenKey(a, b),
    );
  if (failed.length === 0) return null;
  return join(
    html`<section aria-labelledby="viol-h">`,
    heading(
      'viol-h',
      'Violations',
      badge(failed.length, 'bad'),
      html`<a class="more" href="#tab-endpoints" data-show-violations="">All ${plural(failed.length, 'violation')} →</a>`,
    ),
    html`<div class="vlist">${failed.slice(0, RANKING_SIZE).map((e) => violationCard(ctx, e))}</div></section>`,
  );
}

interface Ranking {
  id: string;
  title: string;
  /** What the value is, under the title. */
  note: string;
  empty: string;
  entries: Entry[];
  /** Number the bar length is proportional to. */
  size: (e: Entry) => number;
  /** Bar colour class. */
  tone: (e: Entry) => string;
  value: (e: Entry) => SafeHtml;
}

function rankings(ctx: Ctx): Ranking[] {
  const all = entries(ctx);
  const level = ctx.level;
  const order = (score: (e: Entry) => number[]) => (a: Entry, b: Entry) => {
    const x = score(a);
    const y = score(b);
    for (let i = 0; i < x.length; i++) {
      const d = (y[i] ?? 0) - (x[i] ?? 0);
      if (d !== 0) return d;
    }
    return byKindThenKey(a, b);
  };
  const errorTone = (e: Entry): string =>
    e.agg.evaluation.result === 'fail' ? 'bad' : e.agg.errorCount > 0 ? 'warn' : '';
  const errorShare = (e: Entry): number => e.agg.errorCount / e.agg.count;
  const list: Ranking[] = [
    {
      id: 'slowest',
      title: 'Slowest',
      note: `${level} · samples`,
      empty: 'No timed samples in this run',
      entries: all
        .filter((e) => e.agg.stats !== null)
        .sort(order((e) => [e.agg.stats?.percentiles[level] ?? 0])),
      size: (e) => e.agg.stats?.percentiles[level] ?? 0,
      tone: errorTone,
      value: (e) => html`<b>${formatMs(e.agg.stats?.percentiles[level] ?? 0)}</b> · ${e.agg.count}`,
    },
    {
      id: 'called',
      title: 'Most called',
      note: 'samples · tests',
      empty: 'Nothing was called in this run',
      entries: [...all].sort(order((e) => [e.agg.count])),
      size: (e) => e.agg.count,
      tone: () => 'neu',
      value: (e) => html`<b>${e.agg.count}</b> · ${plural(e.agg.testCount, 'test')}`,
    },
    {
      id: 'errors',
      title: 'Highest error rate',
      note: 'errors',
      empty: 'No errors in this run',
      entries: all
        .filter((e) => e.agg.errorCount > 0)
        .sort(order((e) => [errorShare(e), e.agg.errorCount])),
      size: errorShare,
      tone: errorTone,
      value: (e) =>
        html`<b>${formatPercent(errorShare(e))}</b> · ${e.agg.errorCount} of ${e.agg.count}`,
    },
  ];
  if (!ctx.migrated) {
    const headroom = (e: Entry): number => topCheck(e.agg.evaluation.checks)?.usage ?? Infinity;
    list.push({
      id: 'closest',
      title: 'Closest to limit',
      note: 'passing keys',
      empty: 'No key passed its checks',
      entries: all
        .filter((e) => e.agg.evaluation.result === 'pass' && e.agg.evaluation.checks.length > 0)
        .sort(order((e) => [headroom(e)])),
      size: headroom,
      tone: (e) => (headroom(e) >= NEAR_LIMIT ? 'warn' : ''),
      value: (e) => {
        const top = topCheck(e.agg.evaluation.checks);
        return html`${ruleLabel(top?.rule ?? '', level)} <b>${String(usagePercent(top?.usage ?? 0))}%</b>`;
      },
    });
  }
  return list;
}

/** Empty state of a small card (11-REQ-58). */
function emptySmall(text: string, name: IconName = 'ok'): SafeHtml {
  return html`<div class="empty sm">${icon(name)}<p>${text}</p></div>`;
}

/**
 * Static content of a ranking (11-REQ-31): the first 10 entries of every kind in ranking order;
 * entries after the first 10 of all kinds are hidden until the kind switch selects a kind. Bars
 * are relative to the first entry of the same kind.
 */
function rankingCard(ctx: Ctx, ranking: Ranking): SafeHtml {
  const perKind = new Map<LinkKind, number>();
  const first = new Map<LinkKind, number>();
  const shown = ranking.entries.filter((e) => {
    const n = perKind.get(e.kind) ?? 0;
    perKind.set(e.kind, n + 1);
    if (n === 0) first.set(e.kind, ranking.size(e));
    return n < RANKING_SIZE;
  });
  const item = (e: Entry, i: number): SafeHtml => {
    const top = first.get(e.kind) ?? 0;
    const tone = ranking.tone(e);
    return html`<li data-k="${e.kind}"${i >= RANKING_SIZE ? html` hidden` : null}>${keyLink(ctx, e.kind, e.key, LIST_KEY_MAX)}<span class="tb${tone === '' ? '' : ` ${tone}`}"><span class="${widthClass(top > 0 && Number.isFinite(top) ? ranking.size(e) / top : 1)}"></span></span><span class="v">${ranking.value(e)}</span></li>`;
  };
  return join(
    html`<section class="card" aria-labelledby="rank-${ranking.id}"><div class="card-h"><h4 id="rank-${ranking.id}">${ranking.title}</h4><span class="sub">${ranking.note}</span></div>`,
    shown.length === 0
      ? emptySmall(ranking.empty)
      : html`<ol class="rank" data-rank="${ranking.id}">${shown.map(item)}</ol>`,
    // Kinds without an entry: a message shown by the switch.
    LINK_KINDS.filter((k) => ctx.order[k].length > 0 && !perKind.has(k) && shown.length > 0).map(
      (k) => html`<p class="empty sm" data-k-empty="${k}" hidden>${icon('ok')}${ranking.empty}</p>`,
    ),
    html`</section>`,
  );
}

function rankingsSection(ctx: Ctx): SafeHtml | null {
  const present = LINK_KINDS.filter((k) => ctx.order[k].length > 0);
  if (present.length === 0) return null;
  return join(
    html`<section aria-labelledby="rank-h">`,
    heading(
      'rank-h',
      'Rankings',
      null,
      present.length < 2
        ? null
        : html`<div class="toggle js-only" role="group" aria-label="Key kind in the rankings" data-kinds="" hidden>${present.map(
            (k, i) =>
              html`<button type="button" aria-pressed="${i === 0 ? 'true' : 'false'}" data-k="${k}">${KIND_NAME[k]}</button>`,
          )}</div>`,
    ),
    html`<div class="grid4">${rankings(ctx).map((r) => rankingCard(ctx, r))}</div></section>`,
  );
}

function expensiveTests(ctx: Ctx): SafeHtml | null {
  const tests = ctx.report.testBreakdown?.tests ?? [];
  if (tests.length === 0) return null;
  return join(
    html`<section aria-labelledby="exp-h">`,
    heading(
      'exp-h',
      'Most expensive tests',
      null,
      html`<a class="more" href="#tab-tests">All ${plural(tests.length, 'test')} →</a>`,
    ),
    html`<div class="card"><ul class="tl">${tests
      .slice(0, EXPENSIVE_TESTS)
      .map(
        (t) =>
          html`<li><span class="tt"><span>${truncateMiddle(t.title, 120)}</span><span class="sub">${t.file}:${t.line}</span></span><span class="num">${formatMs(t.totalMs)}<span class="sub">${formatMs(Math.round((t.totalMs / t.executions) * 10) / 10)} per run</span></span><span class="num">${t.requestCount}<span class="sub">requests</span></span></li>`,
      )}</ul></div></section>`,
  );
}

function mutedSection(ctx: Ctx): SafeHtml | null {
  const rows: SafeHtml[] = [];
  let active = 0;
  for (const kind of LINK_KINDS) {
    const map = aggregatesOf(ctx.data, kind);
    for (const key of Object.keys(map).sort(compareText)) {
      const evaluation = map[key]?.evaluation;
      const muted = evaluation?.muted ?? null;
      if (evaluation === undefined || muted === null) continue;
      if (!muted.expired) active++;
      rows.push(
        html`<li><span class="tt">${keyLink(ctx, kind, key, LIST_KEY_MAX)}<span class="sub">${KIND_COLUMN[kind]} · until ${muted.until} · ${muted.note}</span></span><span class="num">${muted.expired ? pill('w', 'mute expired') : null}${evaluation.result === 'fail' ? pill('f', 'has violation') : pill('p', 'no violation')}</span></li>`,
      );
    }
  }
  if (rows.length === 0) return null;
  return join(
    html`<section aria-labelledby="muted-h">`,
    heading('muted-h', 'Muted keys', badge(active), null),
    html`<div class="card"><p class="card-p sub">${plural(active, 'active muting')}, ${plural(rows.length - active, 'expired muting')}.</p><ul class="tl two">${rows}</ul></div></section>`,
  );
}

const COUNTERS: [keyof RunReport['evaluation']['counts']['api'], string][] = [
  ['keys', 'Keys'],
  ['fromFile', 'Evaluated with thresholds from the file'],
  ['fromDefaults', 'Evaluated with default thresholds'],
  ['notEvaluated', 'Not evaluated'],
  ['tooFewSamples', 'Not evaluated: too few samples'],
  ['fileEntriesNotEvaluated', 'File entries not evaluated (small n)'],
  ['medianOnly', 'Evaluated by the median only'],
  ['unseenThresholdEntries', 'File entries not seen in this run'],
  ['violations', 'Violations'],
  ['blockingViolations', 'Blocking violations'],
  ['muted', 'Muted (active)'],
];

function counters(report: RunReport): SafeHtml {
  const counts = report.evaluation.counts;
  // The step column only for a report with step keys or step file entries (11-REQ-47).
  const kinds = LINK_KINDS.filter(
    (k) => k === 'api' || counts[k].keys > 0 || counts[k].unseenThresholdEntries > 0,
  );
  const summary = kinds
    .map((k) => `${KIND_NAME[k]} ${String(counts[k].keys)}`)
    .concat(
      `${String(sum(report, 'fromFile'))} by file, ${String(sum(report, 'fromDefaults'))} by defaults, ${String(sum(report, 'notEvaluated'))} not evaluated`,
    )
    .join(' · ');
  return join(
    html`<section aria-labelledby="counts-h">`,
    heading('counts-h', 'Evaluation counts', null, null),
    html`<details class="card cfg"><summary>${summary}</summary>`,
    html`<div class="scroll" tabindex="0" role="region" aria-label="Evaluation counts table"><table class="counts"><caption>Keys per kind</caption>`,
    html`<thead><tr><th scope="col">Counter</th>${kinds.map((k) => html`<th scope="col" class="num">${KIND_COLUMN[k]}</th>`)}</tr></thead>`,
    html`<tbody>${COUNTERS.map(
      ([f, label]) =>
        html`<tr><th scope="row">${label}</th>${kinds.map((k) => html`<td class="num">${counts[k][f]}</td>`)}</tr>`,
    )}</tbody></table></div></details></section>`,
  );
}

/** Empty state of a run or a tab (11-REQ-58). */
export function emptyState(title: string, text: HtmlValue, docsUrl: string | null): SafeHtml {
  return html`<div class="card empty"><span class="ei">${icon('inbox')}</span><h3>${title}</h3><p>${text}</p>${docsUrl === null ? null : html`<a class="btn sm" href="${docsUrl}" rel="noopener noreferrer">Read the setup guide</a>`}</div>`;
}

/** Content of the Overview tab (11-REQ-29). */
export function overview(ctx: Ctx, docsUrl: string): SafeHtml {
  const empty = LINK_KINDS.every((kind) => ctx.order[kind].length === 0);
  const left = expensiveTests(ctx);
  const right = [mutedSection(ctx), counters(ctx.report)];
  return join(
    empty
      ? emptyState(
          'No requests or steps were recorded',
          html`Measured projects made no requests to the measured origins and ran no <code>test.step</code>. Check the measured projects and that the tests use the package fixture.`,
          docsUrl,
        )
      : null,
    violations(ctx),
    rankingsSection(ctx),
    left === null
      ? html`<div>${right}</div>`
      : html`<div class="grid2"><div>${left}</div><div>${right}</div></div>`,
  );
}
