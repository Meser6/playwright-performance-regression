// Verdict banner, KPI tiles and the Overview tab (11, chapters 6.2 and 6.3).
import { CLI_COMMAND } from '../core/types/index.ts';
import type { RunReport } from '../core/types/index.ts';
import {
  DASH,
  KIND_COLUMN,
  KIND_LABEL,
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
import type { SafeHtml } from './escape.ts';
import {
  formatDate,
  formatMs,
  formatPercent,
  formatRunDuration,
  plural,
  truncateMiddle,
  usagePercent,
  usageText,
} from './format.ts';
import { hintText, ruleLabel } from './hints.ts';
import { icon } from './icons.ts';
import { KEY_COLUMN_MAX, mutedPill, pill, resultPill } from './keys.ts';

/** Entries of each ranking (11-REQ-31) and of the violations list (11-REQ-29). */
const RANKING_SIZE = 10;
const EXPENSIVE_TESTS = 5;

export type BannerStatus = 'ERROR' | 'FAILED' | 'PASSED WITH WARNINGS' | 'PASSED';

function sum(report: RunReport, field: keyof RunReport['evaluation']['counts']['api']): number {
  return LINK_KINDS.reduce((total, kind) => total + report.evaluation.counts[kind][field], 0);
}

/** Failed checks that block, over all keys. */
function blockingChecks(report: RunReport): number {
  let n = 0;
  for (const agg of Object.values(report.endpoints)) {
    n += agg.evaluation.checks.filter((c) => !c.passed && c.blocking).length;
  }
  return n;
}

/** Status and sentence of the banner: the first matching row of 11-REQ-27. */
export function banner(report: RunReport): { status: BannerStatus; sentence: string } {
  const ev = report.evaluation;
  const errors = report.toolErrors;
  if (errors.length > 0 || ev.status === 'error') {
    const first = errors[0];
    return {
      status: 'ERROR',
      sentence:
        first === undefined
          ? 'Evaluation could not run.'
          : `The tool reported ${plural(errors.length, 'error')}: ${first.code} — ${first.message}`,
    };
  }
  const violations = sum(report, 'violations');
  if (ev.status === 'failed' && ev.gateEnabled && report.mode === 'test') {
    return {
      status: 'FAILED',
      sentence: `${plural(blockingChecks(report), 'blocking violation')} in ${plural(sum(report, 'blockingViolations'), 'key')}: the run fails.`,
    };
  }
  if (ev.status === 'warned') {
    return {
      status: 'PASSED WITH WARNINGS',
      sentence: `${plural(violations, 'violation')}, none blocking.`,
    };
  }
  if (ev.status === 'failed') {
    return {
      status: 'PASSED WITH WARNINGS',
      sentence: `Gate off (thresholds mode): ${plural(violations, 'violation')} would fail a test run.`,
    };
  }
  if (report.warnings.length > 0) {
    return {
      status: 'PASSED WITH WARNINGS',
      sentence: `No violations; ${plural(report.warnings.length, 'warning')} to review.`,
    };
  }
  if (report.tests.status !== 'passed') {
    const failed = report.tests.unexpected;
    return {
      status: 'PASSED WITH WARNINGS',
      sentence:
        failed > 0
          ? `${plural(failed, 'test execution')} failed; results may be incomplete.`
          : `The tests ${report.tests.status === 'timedout' ? 'timed out' : report.tests.status}; results may be incomplete.`,
    };
  }
  const evaluated = sum(report, 'fromFile') + sum(report, 'fromDefaults');
  if (evaluated === 0) {
    return {
      status: 'PASSED',
      sentence: 'No key was evaluated (too few samples or no applicable rules).',
    };
  }
  const defaultsOnly =
    sum(report, 'fromFile') === 0 && !report.thresholdFiles.some((f) => f.status === 'loaded');
  return {
    status: 'PASSED',
    sentence:
      `All ${String(evaluated)} evaluated keys are within their limits.` +
      (defaultsOnly
        ? ` Evaluated with default thresholds only; run \`${CLI_COMMAND} thresholds\` to create thresholds files.`
        : ''),
  };
}

const BANNER_CLASS: Record<BannerStatus, string> = {
  ERROR: 'b-error',
  FAILED: 'b-failed',
  'PASSED WITH WARNINGS': 'b-warn',
  PASSED: 'b-pass',
};
const BANNER_ICON: Record<BannerStatus, 'error' | 'fail' | 'warn' | 'pass'> = {
  ERROR: 'error',
  FAILED: 'fail',
  'PASSED WITH WARNINGS': 'warn',
  PASSED: 'pass',
};

export function bannerSection(ctx: Ctx): SafeHtml {
  const { status, sentence } = banner(ctx.report);
  const tool = ctx.report.tool;
  return join(
    html`<section class="banner ${BANNER_CLASS[status]}" aria-labelledby="banner-h">${icon(BANNER_ICON[status])}<div>`,
    html`<h1 id="banner-h">${status}</h1><p>${sentence}</p>`,
    ctx.report.evaluation.gateEnabled ? null : html`<p>${pill('p-ne', 'gate off')}</p>`,
    ctx.migrated
      ? html`<p class="mu">Report format v1 (${tool.name} v${tool.version}): per-test data, histograms, headroom and hints are not available.</p>`
      : null,
    html`</div></section>`,
  );
}

// ---------------------------------------------------------------------------------------------
// KPI tiles (11-REQ-28)

function tile(label: string, value: string, note: string): SafeHtml {
  return html`<div class="kpi"><p class="kl">${label}</p><p class="kv">${value}</p><p class="kn">${note}</p></div>`;
}

export function kpis(ctx: Ctx): SafeHtml {
  const r = ctx.report;
  const endpoints = Object.values(r.endpoints);
  const requests = endpoints.reduce((n, a) => n + a.count, 0);
  const failedRequests = endpoints.reduce((n, a) => n + a.errorCount, 0);
  const measured = r.runConditions.projects.filter((p) => p.role === 'measured');
  const repeats = measured.map((p) => p.repeatEach);
  const lo = Math.min(...repeats);
  const hi = Math.max(...repeats);
  const t = r.tests;
  return join(
    html`<section class="kpis" aria-label="Key figures">`,
    // Other kinds are added as "+ N <kind>"; zero parts are left out (11-REQ-28).
    tile(
      'Endpoints',
      String(endpoints.length),
      Object.keys(r.steps).length === 0 ? '' : `+ ${String(Object.keys(r.steps).length)} steps`,
    ),
    tile(
      'Violations',
      String(sum(r, 'violations')),
      `${String(sum(r, 'blockingViolations'))} blocking · ${String(sum(r, 'muted'))} muted`,
    ),
    tile(
      'Error rate',
      requests === 0 ? DASH : formatPercent(failedRequests / requests),
      `${String(failedRequests)} of ${plural(requests, 'request')}`,
    ),
    tile('Run duration', formatRunDuration(r.startedAt, r.finishedAt), formatDate(r.startedAt)),
    tile(
      'Repetitions',
      repeats.length === 0 ? DASH : lo === hi ? String(lo) : `${String(lo)}–${String(hi)}`,
      plural(measured.length, 'measured project'),
    ),
    tile(
      'Tests',
      String(t.expected + t.unexpected + t.flaky),
      `${String(t.unexpected)} failed · ${String(t.flaky)} flaky · ${String(t.skipped)} skipped`,
    ),
    html`</section>`,
  );
}

// ---------------------------------------------------------------------------------------------
// Verdict (11-REQ-08)

function card(title: string, cls: string, status: string, ...notes: (SafeHtml | null)[]): SafeHtml {
  return html`<div class="card ${cls}"><h3>${title}</h3><p class="status">${status}</p>${notes}</div>`;
}

function verdict(report: RunReport): SafeHtml {
  const t = report.tests;
  const untrustworthy = report.toolErrors.some((i) => i.code === 'TESTS_FAILED_TOO_MANY');
  const perf = report.evaluation.status;
  const errors = report.toolErrors.length;
  return join(
    html`<section aria-labelledby="verdict-h"><h3 id="verdict-h" class="sr">Verdict</h3><div class="verdict">`,
    card(
      'Tests',
      t.status === 'passed' ? 'ok' : 'warn',
      t.status === 'timedout' ? 'timed out' : t.status,
      html`<p>${t.expected} expected · ${t.unexpected} unexpected · ${t.flaky} flaky · ${t.skipped} skipped</p>`,
      untrustworthy
        ? html`<p class="note">Too many tests failed: the performance result is not trustworthy.</p>`
        : t.unexpected > 0
          ? html`<p class="note">Failed tests are information, not the performance verdict.</p>`
          : null,
    ),
    card(
      'Performance',
      perf === 'passed' ? 'ok' : perf === 'warned' ? 'warn' : 'bad',
      perf,
      report.evaluation.gateEnabled ? null : html`<p class="note">gate off (thresholds mode)</p>`,
    ),
    card('Tool errors', errors === 0 ? 'ok' : 'bad', errors === 0 ? 'none' : String(errors)),
    html`</div></section>`,
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

function shortKey(key: string): SafeHtml {
  const short = truncateMiddle(key, KEY_COLUMN_MAX);
  return short === key ? html`${key}` : html`<span title="${key}">${short}</span>`;
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
  const item = (e: Entry): SafeHtml => {
    const top = ctx.migrated ? undefined : topCheck(e.agg.evaluation.checks);
    const hint = ctx.migrated ? undefined : e.agg.hints[0];
    return join(
      html`<li>${resultPill(e.agg.evaluation)}${pill('p-kind', KIND_LABEL[e.kind])}${mutedPill(e.agg.evaluation.muted)} `,
      keyLink(ctx, e.kind, e.key, shortKey(e.key)),
      top === undefined
        ? null
        : html` <span class="mu">· ${ruleLabel(top.rule, ctx.level)} ${usageText(top.usage, !top.passed, true)}</span>`,
      hint === undefined
        ? null
        : html`<br><span class="hint">${hintText(hint, ctx.level, e.agg.evaluation.muted)}</span>`,
      html`</li>`,
    );
  };
  return join(
    html`<section aria-labelledby="viol-h"><h3 id="viol-h">Violations</h3>`,
    html`<ul class="list">${failed.slice(0, RANKING_SIZE).map(item)}</ul>`,
    html`<p><a href="#tab-endpoints" data-show-violations="">All ${plural(failed.length, 'violation')}</a></p>`,
    html`</section>`,
  );
}

interface Ranking {
  id: string;
  title: string;
  empty: string;
  entries: Entry[];
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
  const list: Ranking[] = [
    {
      id: 'slowest',
      title: 'Slowest',
      empty: 'No timed samples in this run',
      entries: all
        .filter((e) => e.agg.stats !== null)
        .sort(order((e) => [e.agg.stats?.percentiles[level] ?? 0])),
      value: (e) =>
        html`${level} ${formatMs(e.agg.stats?.percentiles[level] ?? 0)} · ${plural(e.agg.count, 'sample')}`,
    },
    {
      id: 'called',
      title: 'Most called',
      empty: 'Nothing was called in this run',
      entries: [...all].sort(order((e) => [e.agg.count])),
      value: (e) => html`${plural(e.agg.count, 'call')} · ${plural(e.agg.testCount, 'test')}`,
    },
    {
      id: 'errors',
      title: 'Highest error rate',
      empty: 'No errors in this run',
      entries: all
        .filter((e) => e.agg.errorCount > 0)
        .sort(order((e) => [e.agg.errorCount / e.agg.count, e.agg.errorCount])),
      value: (e) =>
        html`${formatPercent(e.agg.errorCount / e.agg.count)} · ${String(e.agg.errorCount)} of ${String(e.agg.count)}`,
    },
  ];
  if (!ctx.migrated) {
    const headroom = (e: Entry): number => topCheck(e.agg.evaluation.checks)?.usage ?? Infinity;
    list.push({
      id: 'closest',
      title: 'Closest to limit',
      empty: 'No key passed its checks',
      entries: all
        .filter((e) => e.agg.evaluation.result === 'pass' && e.agg.evaluation.checks.length > 0)
        .sort(order((e) => [headroom(e)])),
      value: (e) => {
        const top = topCheck(e.agg.evaluation.checks);
        return html`${ruleLabel(top?.rule ?? '', level)} at ${String(usagePercent(top?.usage ?? 0))}% of limit`;
      },
    });
  }
  return list;
}

/**
 * Static content of a ranking (11-REQ-31): the first 10 entries of every kind in ranking order;
 * entries after the first 10 of all kinds are hidden until the kind toggles change.
 */
function rankingList(ctx: Ctx, ranking: Ranking): SafeHtml {
  const perKind = new Map<LinkKind, number>();
  const shown = ranking.entries.filter((e) => {
    const n = perKind.get(e.kind) ?? 0;
    perKind.set(e.kind, n + 1);
    return n < RANKING_SIZE;
  });
  return join(
    html`<div class="rank"><h4>${ranking.title}</h4>`,
    shown.length === 0
      ? html`<p class="mu">${ranking.empty}</p>`
      : html`<ol data-rank="${ranking.id}">${shown.map(
          (e, i) =>
            html`<li data-k="${e.kind}"${i >= RANKING_SIZE ? html` hidden` : null}>${keyLink(ctx, e.kind, e.key, shortKey(e.key))} <span class="mu">${ranking.value(e)}</span></li>`,
        )}</ol>`,
    html`</div>`,
  );
}

function rankingsSection(ctx: Ctx): SafeHtml | null {
  const present = LINK_KINDS.filter((k) => ctx.order[k].length > 0);
  if (present.length === 0) return null;
  return join(
    html`<section aria-labelledby="rank-h"><h3 id="rank-h">Rankings</h3>`,
    present.length < 2
      ? null
      : html`<div class="chips js-only" role="group" aria-label="Kinds in the rankings" data-kinds="" hidden>${present.map(
          (k) =>
            html`<button type="button" class="chip" aria-pressed="true" data-k="${k}">${KIND_NAME[k]}</button>`,
        )}</div>`,
    html`<div class="ranks">${rankings(ctx).map((r) => rankingList(ctx, r))}</div></section>`,
  );
}

function expensiveTests(ctx: Ctx): SafeHtml | null {
  const tests = ctx.report.testBreakdown?.tests ?? [];
  if (tests.length === 0) return null;
  return join(
    html`<section aria-labelledby="exp-h"><h3 id="exp-h">Most expensive tests</h3><ol class="list">`,
    tests
      .slice(0, EXPENSIVE_TESTS)
      .map(
        (t) =>
          html`<li>${truncateMiddle(t.title, 120)} <span class="mu">· total wait ${formatMs(t.totalMs)} · ${formatMs(Math.round((t.totalMs / t.executions) * 10) / 10)} per run · ${plural(t.requestCount, 'request')}</span></li>`,
      ),
    html`</ol><p><a href="#tab-tests">All tests</a></p></section>`,
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
        join(
          html`<tr><th scope="row" class="key">${keyLink(ctx, kind, key, key)}</th><td>${KIND_COLUMN[kind]}</td><td>${muted.until}</td>`,
          html`<td>${muted.expired ? pill('p-exp', 'expired') : 'active'}</td>`,
          html`<td>${evaluation.result === 'fail' ? 'yes' : 'no'}</td>`,
          html`<td>${muted.note}</td></tr>`,
        ),
      );
    }
  }
  if (rows.length === 0) return null;
  return join(
    html`<section aria-labelledby="muted-h"><h3 id="muted-h">Muted keys</h3>`,
    html`<p>${plural(active, 'active muting')}, ${plural(rows.length - active, 'expired muting')}.</p>`,
    html`<div class="scroll" tabindex="0" role="region" aria-label="Muted keys table"><table><caption>Keys muted in the thresholds files</caption>`,
    html`<thead><tr><th scope="col">Key</th><th scope="col">Kind</th><th scope="col">Until</th>`,
    html`<th scope="col">State</th><th scope="col">Violation</th><th scope="col">Note</th></tr></thead>`,
    html`<tbody>${rows}</tbody></table></div></section>`,
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
  return join(
    html`<section aria-labelledby="counts-h"><details><summary><h3 id="counts-h">Evaluation counts</h3></summary>`,
    html`<div class="scroll" tabindex="0" role="region" aria-label="Evaluation counts table"><table class="counts"><caption>Keys per kind</caption>`,
    html`<thead><tr><th scope="col">Counter</th>${kinds.map((k) => html`<th scope="col">${KIND_COLUMN[k]}</th>`)}</tr></thead>`,
    html`<tbody>${COUNTERS.map(
      ([field, label]) =>
        html`<tr><th scope="row">${label}</th>${kinds.map((k) => html`<td>${counts[k][field]}</td>`)}</tr>`,
    )}</tbody></table></div></details></section>`,
  );
}

/** Content of the Overview tab (11-REQ-29). */
export function overview(ctx: Ctx, docsUrl: string): SafeHtml {
  const empty = LINK_KINDS.every((kind) => ctx.order[kind].length === 0);
  return join(
    verdict(ctx.report),
    empty
      ? html`<p>No requests or steps were recorded. See the <a href="${docsUrl}" rel="noopener noreferrer">documentation</a> for setting up the measured tests.</p>`
      : null,
    violations(ctx),
    rankingsSection(ctx),
    expensiveTests(ctx),
    mutedSection(ctx),
    counters(ctx.report),
  );
}
