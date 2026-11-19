// Static HTML report of one run (11): a pure function of the run report (11-REQ-02). The page is
// complete without JavaScript (11-REQ-03); the embedded script only sorts, filters and downloads
// the embedded data (11-D-02). Styles and script are build-time constants with their SHA-256
// hashes for the Content-Security-Policy (11-REQ-23, 11-REQ-24).
import { PACKAGE_NAME, REPOSITORY_URL } from '../core/types/index.ts';
import type {
  Check,
  Issue,
  KeyEvaluation,
  RunReport,
  ThresholdFileInfo,
} from '../core/types/index.ts';
import { percentileBar } from './bar.ts';
import { embeddedJson, stableJson, toHtmlReportData } from './data.ts';
import type { HtmlAggregate, HtmlReportData } from './data.ts';
import { html, trustedHtml } from './escape.ts';
import type { HtmlValue, SafeHtml } from './escape.ts';
import {
  formatDate,
  formatMs,
  formatRatio,
  formatRunDuration,
  plural,
  truncateMiddle,
} from './format.ts';
import { SCRIPT, SCRIPT_SHA256, STYLES, STYLES_SHA256 } from './generated/assets.ts';

/** Keys longer than this are shortened in the middle in the table (11, chapter 6.1). */
export const KEY_COLUMN_MAX = 80;
/** Evaluated percentile when the config snapshot omits it: the schema default (03). */
const DEFAULT_PERCENTILE = 'p95';
const TIME_RULES: ReadonlySet<Check['rule']> = new Set<Check['rule']>([
  'median',
  'percentile',
  'p99',
]);
const DASH = '—';

type TableKind = 'endpoints' | 'custom';
type KeyFacts = Pick<HtmlAggregate, 'stats' | 'evaluation'>;

/** Concatenates template parts; lets long markup be written one piece per line. */
function join(...parts: HtmlValue[]): SafeHtml {
  return html`${parts}`;
}

function percentileLevel(report: RunReport): string {
  return report.config.checks?.time?.percentile?.level ?? DEFAULT_PERCENTILE;
}

function isBlocking(evaluation: KeyEvaluation): boolean {
  return evaluation.result === 'fail' && evaluation.checks.some((c) => c.blocking);
}

/** 0 blocking violation, 1 other violation, 2 pass, 3 not evaluated (11-REQ-09). */
export function rowGroup(evaluation: KeyEvaluation): 0 | 1 | 2 | 3 {
  if (evaluation.result === 'fail') return isBlocking(evaluation) ? 0 : 1;
  return evaluation.result === 'pass' ? 2 : 3;
}

/** Evaluated percentile divided by its limit; -Infinity without a value (11-REQ-09). */
export function limitRatio(agg: KeyFacts, level: string): number {
  const value = agg.stats?.percentiles[level];
  if (value === undefined) return -Infinity;
  const limit = agg.evaluation.limits.percentile;
  if (limit === 0) return value === 0 ? 0 : Infinity;
  return value / limit;
}

/** Keys in the default order (11-REQ-09): group, then the ratio descending, then the key. */
export function defaultOrder(
  aggregates: Readonly<Record<string, KeyFacts>>,
  level: string,
): string[] {
  const rows = Object.keys(aggregates).map((key) => {
    const agg = aggregates[key] as KeyFacts;
    return { key, group: rowGroup(agg.evaluation), ratio: limitRatio(agg, level) };
  });
  rows.sort((a, b) => {
    if (a.group !== b.group) return a.group - b.group;
    if (a.ratio !== b.ratio) return a.ratio > b.ratio ? -1 : 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return rows.map((r) => r.key);
}

function reasonText(reason: KeyEvaluation['reason']): string | null {
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

function resultText(evaluation: KeyEvaluation): string {
  if (evaluation.result === 'fail') return isBlocking(evaluation) ? 'fail (blocking)' : 'fail';
  return evaluation.result === 'pass' ? 'pass' : 'not evaluated';
}

function resultClass(evaluation: KeyEvaluation): string {
  if (evaluation.result === 'fail') return isBlocking(evaluation) ? 'bad' : 'warn';
  return evaluation.result === 'pass' ? 'ok' : 'muted-text';
}

function mutedText(muted: KeyEvaluation['muted']): string | null {
  if (muted === null) return null;
  const until = muted.until.slice(0, 10);
  return muted.expired ? `mute expired ${until}` : `muted until ${until}`;
}

function ruleName(rule: Check['rule'], level: string): string {
  return rule === 'percentile' ? level : rule;
}

function checkValue(check: Check, value: number): string {
  return TIME_RULES.has(check.rule) ? formatMs(value) : formatRatio(value);
}

/** Lowest minSamples of the enabled rules in the config snapshot; null when unknown. */
function lowestMinSamples(report: RunReport): { rule: string; n: number } | null {
  const checks = report.config.checks;
  if (checks === undefined) return null;
  const rules: [string, { enabled?: boolean; minSamples?: number } | undefined][] = [
    ['median', checks.time?.median],
    [percentileLevel(report), checks.time?.percentile],
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

// ---------------------------------------------------------------------------------------------
// Header, verdict, muted keys, counters, issues (11, chapter 6)

/** ci.buildUrl is a link only for http(s) URLs; any other value is text (11-REQ-22a). */
export function buildLink(url: string | null): HtmlValue {
  if (url === null) return DASH;
  return /^https?:\/\//iu.test(url.trimStart())
    ? html`<a href="${url}" rel="noopener noreferrer">${url}</a>`
    : html`<code>${url}</code>`;
}

function header(report: RunReport): SafeHtml {
  const { ci, host } = report;
  const items: [string, HtmlValue][] = [
    ['Run ID', html`<code>${report.runId}</code>`],
    ['Started', formatDate(report.startedAt)],
    ['Duration', formatRunDuration(report.startedAt, report.finishedAt)],
    ['Mode', report.mode],
    ['Environment', report.env ?? DASH],
    ['Playwright', report.playwright.version],
    ['Node.js', host.nodeVersion],
    ['System', `${host.platform} ${host.arch}`],
    [
      'CPU',
      `${host.cpuModel === '' ? 'unknown' : host.cpuModel} (${plural(host.cpuCount, 'core')})`,
    ],
  ];
  if (ci !== null) {
    items.push(
      ['CI', ci.provider],
      ['Commit', ci.commit === null ? DASH : html`<code>${ci.commit}</code>`],
      ['Branch', ci.branch ?? DASH],
      ['Build', buildLink(ci.buildUrl)],
    );
  }
  const origin = (o: RunReport['origins'][number]): SafeHtml =>
    join(
      html`<li><code>${o.origin}</code> `,
      o.label === ''
        ? html`<span class="muted-text">(base)</span>`
        : html`label <code>${o.label}</code>`,
      html` · ${plural(o.requestCount, 'request')}</li>`,
    );
  return join(
    html`<header class="page-header">`,
    html`<p class="tool">${report.tool.name} v${report.tool.version}</p>`,
    html`<h1>Performance report</h1>`,
    html`<dl class="meta">${items.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`,
    report.origins.length === 0
      ? null
      : html`<h2 class="sub">Measured origins</h2><ul class="origins">${report.origins.map(origin)}</ul>`,
    html`</header>`,
  );
}

function card(title: string, cls: string, status: string, ...notes: HtmlValue[]): SafeHtml {
  return html`<div class="card ${cls}"><h3>${title}</h3><p class="status">${status}</p>${notes}</div>`;
}

/** Tests, Performance and Tool errors, each with text and colour (11-REQ-08, P-08). */
function verdict(report: RunReport): SafeHtml {
  const t = report.tests;
  const untrustworthy = report.toolErrors.some((i) => i.code === 'TESTS_FAILED_TOO_MANY');
  const perf = report.evaluation.status;
  const errors = report.toolErrors.length;
  return join(
    html`<section aria-labelledby="verdict-h"><h2 id="verdict-h">Verdict</h2><div class="verdict">`,
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

/** Muted keys with note, until and violation; hidden when nothing is muted (09-REQ-26). */
function mutedSection(report: RunReport): SafeHtml | null {
  const rows: SafeHtml[] = [];
  let active = 0;
  for (const [kind, map] of [
    ['API', report.endpoints],
    ['Custom', report.custom],
  ] as const) {
    for (const key of Object.keys(map).sort()) {
      const evaluation = map[key]?.evaluation;
      const muted = evaluation?.muted ?? null;
      if (evaluation === undefined || muted === null) continue;
      if (!muted.expired) active++;
      rows.push(
        join(
          html`<tr><th scope="row" class="key">${key}</th><td>${kind}</td><td>${muted.until}</td>`,
          html`<td>${muted.expired ? html`<span class="warn">expired</span>` : 'active'}</td>`,
          html`<td>${evaluation.result === 'fail' ? html`<span class="warn">yes</span>` : 'no'}</td>`,
          html`<td>${muted.note}</td></tr>`,
        ),
      );
    }
  }
  if (rows.length === 0) return null;
  return join(
    html`<section aria-labelledby="muted-h"><h2 id="muted-h">Muted keys</h2>`,
    html`<p>${plural(active, 'active muting')}, ${plural(rows.length - active, 'expired muting')}.</p>`,
    html`<div class="scroll"><table><caption>Keys muted in the thresholds files</caption>`,
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
  const { api, custom } = report.evaluation.counts;
  return join(
    html`<section aria-labelledby="counters-h"><h2 id="counters-h">Counters</h2>`,
    html`<div class="scroll"><table class="counters"><caption>Keys per kind</caption>`,
    html`<thead><tr><th scope="col">Counter</th><th scope="col" class="num">API</th><th scope="col" class="num">Custom</th></tr></thead>`,
    html`<tbody>${COUNTERS.map(
      ([field, label]) =>
        html`<tr><th scope="row">${label}</th><td class="num">${api[field]}</td><td class="num">${custom[field]}</td></tr>`,
    )}</tbody></table></div></section>`,
  );
}

function issueList(issues: readonly Issue[], level: 'error' | 'warning'): SafeHtml {
  const item = (i: Issue): SafeHtml =>
    join(
      html`<li class="${level === 'error' ? 'bad' : 'warn'}"><p><strong>${level}</strong> <code>${i.code}</code>`,
      i.count !== undefined && i.count > 1 ? html` <span class="count">×${i.count}</span>` : null,
      html`</p><p>${i.message}</p>`,
      i.hint === undefined ? null : html`<p class="hint">Hint: ${i.hint}</p>`,
      html`</li>`,
    );
  return html`<ul class="issues">${issues.map(item)}</ul>`;
}

/** Warnings and tool errors; hidden when both are empty, highlighted on an error status. */
function issuesSection(report: RunReport): SafeHtml | null {
  const { warnings, toolErrors } = report;
  if (warnings.length === 0 && toolErrors.length === 0) return null;
  const cls = report.evaluation.status === 'error' ? 'issues-section highlight' : 'issues-section';
  return join(
    html`<section aria-labelledby="issues-h" class="${cls}"><h2 id="issues-h">Warnings and errors</h2>`,
    toolErrors.length === 0
      ? null
      : html`<h3>Tool errors (${toolErrors.length})</h3>${issueList(toolErrors, 'error')}`,
    warnings.length === 0
      ? null
      : html`<h3>Warnings (${warnings.length})</h3>${issueList(warnings, 'warning')}`,
    html`</section>`,
  );
}

// ---------------------------------------------------------------------------------------------
// Key tables (11, chapter 6.1) and key details (11, chapter 6.2)

function checksTable(agg: HtmlAggregate, level: string, report: RunReport): SafeHtml {
  const ev = agg.evaluation;
  if (ev.result === 'not-evaluated') {
    const reason = reasonText(ev.reason);
    const lowest = lowestMinSamples(report);
    return join(
      html`<p>Not evaluated${reason === null ? '' : `: ${reason}`}.`,
      lowest === null
        ? null
        : ` The lowest rule (${lowest.rule}) needs ${plural(lowest.n, 'sample')}; this key has ${String(agg.successCount)} successful of ${plural(agg.count, 'sample')}.`,
      html`</p>`,
    );
  }
  const row = (c: Check): SafeHtml =>
    join(
      html`<tr><th scope="row">${ruleName(c.rule, level)}</th><td class="num">${c.n}</td>`,
      html`<td class="num">${checkValue(c, c.actual)}</td>`,
      html`<td class="num">${c.observed === null ? DASH : formatRatio(c.observed)}</td>`,
      html`<td class="num">${checkValue(c, c.limit)}</td>`,
      html`<td><span class="${c.passed ? 'ok' : 'bad'}">${c.passed ? 'pass' : 'fail'}</span></td>`,
      html`<td>${c.blocking ? 'yes' : 'no'}</td><td>${c.hardLimitExceeded ? 'yes' : 'no'}</td></tr>`,
    );
  return join(
    html`<table class="checks"><caption>Checks</caption><thead><tr>`,
    html`<th scope="col">Rule</th><th scope="col" class="num">n</th>`,
    html`<th scope="col" class="num">Compared value</th><th scope="col" class="num">Observed</th>`,
    html`<th scope="col" class="num">Limit</th><th scope="col">Result</th><th scope="col">Blocking</th>`,
    html`<th scope="col">Hard limit exceeded</th></tr></thead><tbody>${ev.checks.map(row)}</tbody></table>`,
  );
}

function testRef(t: { title: string; project: string; file: string; line: number }): SafeHtml {
  const project = t.project === '' ? 'default project' : t.project;
  return html`${t.title} <span class="muted-text">(${project}, <code>${t.file}:${t.line}</code>)</span>`;
}

function fact(label: string, value: HtmlValue): SafeHtml {
  return html`<div><dt>${label}</dt><dd>${value}</dd></div>`;
}

function details(
  key: string,
  agg: HtmlAggregate,
  kind: TableKind,
  report: RunReport,
  level: string,
): SafeHtml {
  const statuses = Object.keys(agg.statuses).sort();
  const bar = percentileBar(agg.stats, agg.evaluation.limits, level);
  const statusList = statuses.map(
    (s, i) => html`${i > 0 ? ', ' : ''}<code>${s}</code> → ${agg.statuses[s] ?? 0}`,
  );
  const sampling = agg.samples.sampled
    ? ' (sampled: the key had more successful samples than the limit)'
    : ' (all successful samples)';
  return join(
    html`<p class="full-key"><code>${key}</code></p>`,
    checksTable(agg, level, report),
    bar ?? html`<p>No successful samples, so there are no time statistics.</p>`,
    html`<dl class="facts">`,
    fact('Statuses', statuses.length === 0 ? DASH : statusList),
    fact('Samples from failed tests', agg.fromFailedTests),
    agg.timeSources.node > 0
      ? fact(
          'Time sources',
          `browser ${String(agg.timeSources.browser)}, node ${String(agg.timeSources.node)}`,
        )
      : null,
    kind === 'endpoints'
      ? fact(
          'TTFB',
          agg.ttfb === null ? DASH : `p50 ${formatMs(agg.ttfb.p50)}, p95 ${formatMs(agg.ttfb.p95)}`,
        )
      : null,
    fact('Retained samples', `${String(agg.samples.retained)}${sampling}`),
    html`</dl>`,
    agg.slowest.length === 0
      ? null
      : html`<h4>Slowest samples</h4><ol class="slowest">${agg.slowest.map((s) =>
          join(
            html`<li><strong>${formatMs(s.duration)}</strong> at ${formatDate(s.startedAt)} · `,
            html`${testRef(s.test)} · repeat ${s.test.repeatEachIndex}`,
            s.url === undefined ? null : html`<br><span class="url">${s.url}</span>`,
            html`</li>`,
          ),
        )}</ol>`,
    agg.topTests.length === 0
      ? null
      : html`<h4>Tests calling this key most often</h4><ol class="top-tests">${agg.topTests.map(
          (t) => html`<li>${testRef(t)} · ${plural(t.sampleCount, 'sample')}</li>`,
        )}</ol>`,
  );
}

function percentileCell(value: number | undefined, limit: number): SafeHtml {
  return value === undefined
    ? html`${DASH}`
    : html`${formatMs(value)} <span class="limit">/ ${formatMs(limit)}</span>`;
}

/** One key: a tbody with the table row and the details row below it (11, chapter 6.2). */
function keyRow(
  key: string,
  agg: HtmlAggregate,
  kind: TableKind,
  report: RunReport,
  level: string,
  columns: number,
): SafeHtml {
  const ev = agg.evaluation;
  const s = agg.stats;
  const reason = reasonText(ev.reason);
  const muted = mutedText(ev.muted);
  const group = rowGroup(ev);
  const short = truncateMiddle(key, KEY_COLUMN_MAX);
  const time = (value: number | undefined): HtmlValue =>
    value === undefined ? DASH : formatMs(value);
  return join(
    html`<tbody class="key-group" data-key="${key}" data-result="${ev.result}" data-group="${group}"><tr>`,
    html`<th scope="row" class="key"${short === key ? null : html` title="${key}"`}>${short}</th>`,
    html`<td><span class="${resultClass(ev)}">${resultText(ev)}</span> <span class="muted-text">· ${ev.thresholdSource}</span>`,
    reason === null ? null : html`<br><span class="muted-text">${reason}</span>`,
    muted === null
      ? null
      : html`<br><span class="${ev.muted?.expired === true ? 'warn' : 'muted-text'}">${muted}</span>`,
    html`</td><td class="num">${agg.successCount} / ${agg.count}</td>`,
    html`<td class="num">${agg.errorCount === 0 ? null : agg.errorCount}</td>`,
    html`<td class="num">${time(s?.percentiles['p50'])}</td>`,
    html`<td class="num">${s === null ? DASH : percentileCell(s.percentiles[level], ev.limits.percentile)}</td>`,
    html`<td class="num">${s === null ? DASH : percentileCell(s.percentiles['p99'], ev.limits.p99)}</td>`,
    html`<td class="num">${time(s?.max)}</td>`,
    kind === 'endpoints' ? html`<td class="num">${time(agg.ttfb?.p50)}</td>` : null,
    html`<td class="num">${agg.testCount}</td></tr>`,
    html`<tr class="details-row"><td colspan="${columns}"><details${group <= 1 ? html` data-violation=""` : null}>`,
    html`<summary>Details <span class="visually-hidden">of ${short}</span></summary>`,
    html`<div class="details-body">${details(key, agg, kind, report, level)}</div></details></td></tr></tbody>`,
  );
}

function keyTable(
  kind: TableKind,
  aggregates: Record<string, HtmlAggregate>,
  report: RunReport,
  level: string,
): SafeHtml {
  const title = kind === 'endpoints' ? 'Endpoints' : 'Custom measurements';
  const id = `${kind}-table`;
  const cols: [column: string, label: string, numeric: boolean][] = [
    ['key', 'Key', false],
    ['result', 'Result', false],
    ['samples', 'Samples', true],
    ['errors', 'Errors', true],
    ['p50', 'p50', true],
    ['percentile', `${level} / limit`, true],
    ['p99', 'p99 / limit', true],
    ['max', 'Max', true],
    ...(kind === 'endpoints' ? [['ttfb', 'TTFB p50', true] as [string, string, boolean]] : []),
    ['tests', 'Tests', true],
  ];
  const keys = defaultOrder(aggregates, level);
  const headerCell = ([column, label, numeric]: [string, string, boolean]): SafeHtml =>
    html`<th scope="col" data-sort="${column}"${numeric ? html` class="num"` : null}><button type="button">${label}</button></th>`;
  return join(
    html`<section aria-labelledby="${kind}-h"><h2 id="${kind}-h">${title}</h2>`,
    html`<div class="filters" data-filters-for="${id}" hidden>`,
    html`<label>Filter keys <input type="search" data-filter="text" autocomplete="off"></label>`,
    html`<label><input type="checkbox" data-filter="violations"> Only violations</label>`,
    html`<label><input type="checkbox" data-filter="not-evaluated"> Hide not evaluated</label>`,
    html`<span class="count" role="status" data-count>showing ${keys.length} of ${keys.length}</span></div>`,
    html`<div class="scroll"><table id="${id}" class="keys" data-kind="${kind}" data-percentile="${level}">`,
    html`<caption>${title}: ${plural(keys.length, 'key')}, violations first</caption>`,
    html`<thead><tr>${cols.map(headerCell)}</tr></thead>`,
    keys.map((key) =>
      keyRow(key, aggregates[key] as HtmlAggregate, kind, report, level, cols.length),
    ),
    html`</table></div></section>`,
  );
}

// ---------------------------------------------------------------------------------------------
// Thresholds files, run conditions, configuration, footer

function field(object: unknown, name: string): unknown {
  return typeof object === 'object' && object !== null
    ? (object as Record<string, unknown>)[name]
    : undefined;
}

function textOf(value: unknown): string | null {
  if (typeof value === 'string') return value;
  return typeof value === 'number' ? String(value) : null;
}

function generatedSource(file: ThresholdFileInfo): string {
  const generated = file.generated;
  if (generated === null) return file.status === 'loaded' ? 'hand-written' : DASH;
  const tool = field(generated, 'tool');
  const run = textOf(field(generated, 'sourceRunId'));
  const at = textOf(field(generated, 'sourceRunStartedAt'));
  const count = field(generated, 'sourceSampleCount');
  return [
    `generated by ${textOf(field(tool, 'name')) ?? 'unknown'} v${textOf(field(tool, 'version')) ?? '?'}`,
    run === null ? '' : ` from run ${run}`,
    at === null ? '' : ` (${formatDate(at)})`,
    typeof count === 'number' ? `, ${plural(count, 'sample')}` : '',
  ].join('');
}

function thresholdsFileRow(file: ThresholdFileInfo, report: RunReport): SafeHtml {
  const percentile = textOf(field(file.generated, 'evaluatedPercentile'));
  const fingerprint = textOf(field(file.generated, 'normalization'));
  let normalization: SafeHtml;
  if (fingerprint === null) normalization = html`run <code>${report.normalization}</code>`;
  else if (fingerprint === report.normalization)
    normalization = html`<code>${fingerprint}</code> <span class="ok">matches this run</span>`;
  else
    normalization = html`file <code>${fingerprint}</code>, run <code>${report.normalization}</code> <strong class="warn">differs: keys may not match</strong>`;
  const statusClass =
    file.status === 'loaded' ? 'ok' : file.status === 'invalid' ? 'bad' : 'muted-text';
  const unseen = file.unseenKeys;
  return join(
    html`<tr><td>${file.kind}</td><td><code>${file.path}</code></td>`,
    html`<td><span class="${statusClass}">${file.status}</span></td><td>${percentile ?? DASH}</td>`,
    html`<td>${generatedSource(file)}</td><td>${normalization}</td><td>`,
    unseen.length === 0
      ? '0'
      : html`<details><summary>${plural(unseen.length, 'key')}</summary><ul class="plain">${unseen.map((k) => html`<li><code>${k}</code></li>`)}</ul></details>`,
    html`</td></tr>`,
  );
}

function thresholdsSection(report: RunReport): SafeHtml {
  const files = report.thresholdFiles;
  return join(
    html`<section aria-labelledby="thresholds-h"><h2 id="thresholds-h">Thresholds files</h2>`,
    files.length === 0
      ? html`<p>No thresholds files were loaded in this run.</p>`
      : join(
          html`<div class="scroll"><table><caption>Thresholds files of this run</caption><thead><tr>`,
          html`<th scope="col">Kind</th><th scope="col">Path</th><th scope="col">Status</th>`,
          html`<th scope="col">Percentile</th><th scope="col">Source</th>`,
          html`<th scope="col">Normalization fingerprint</th><th scope="col">Unseen keys</th>`,
          html`</tr></thead><tbody>${files.map((f) => thresholdsFileRow(f, report))}</tbody></table></div>`,
        ),
    html`</section>`,
  );
}

function runConditions(report: RunReport): SafeHtml {
  const rc = report.runConditions;
  const overridden =
    rc.overriddenSettings.length === 0
      ? 'none'
      : rc.overriddenSettings.map((s, i) => html`${i > 0 ? ', ' : ''}<code>${s}</code>`);
  const project = (p: RunReport['runConditions']['projects'][number]): SafeHtml =>
    join(
      html`<tr><th scope="row">${p.name === '' ? '(default)' : p.name}</th><td>${p.role}</td>`,
      html`<td>${p.browserName ?? DASH}</td><td class="num">${p.repeatEach}</td><td class="num">${p.retries}</td></tr>`,
    );
  return join(
    html`<section aria-labelledby="conditions-h"><h2 id="conditions-h">Run conditions</h2>`,
    html`<p>${plural(rc.workers, 'worker')}. Settings overridden by withPerf(): ${overridden}.</p>`,
    rc.projects.length === 0
      ? null
      : join(
          html`<div class="scroll"><table><caption>Projects</caption><thead><tr>`,
          html`<th scope="col">Project</th><th scope="col">Role</th><th scope="col">Browser</th>`,
          html`<th scope="col" class="num">repeatEach</th><th scope="col" class="num">retries</th>`,
          html`</tr></thead><tbody>${rc.projects.map(project)}</tbody></table></div>`,
        ),
    html`</section>`,
  );
}

function configuration(report: RunReport): SafeHtml {
  return join(
    html`<section aria-labelledby="config-h"><h2 id="config-h">Configuration</h2>`,
    html`<details><summary>Configuration snapshot</summary>`,
    html`<pre><code>${stableJson(report.config, '  ')}</code></pre></details></section>`,
  );
}

/** Only the project link, without promotional content (11-REQ-20, 11-D-05). */
function footer(report: RunReport): SafeHtml {
  return html`<footer>Generated by <a href="${REPOSITORY_URL}" rel="noopener noreferrer">${report.tool.name}</a> v${report.tool.version}</footer>`;
}

function keySections(data: HtmlReportData, report: RunReport): HtmlValue {
  const level = percentileLevel(report);
  const hasEndpoints = Object.keys(data.endpoints).length > 0;
  const hasCustom = Object.keys(data.custom).length > 0;
  if (!hasEndpoints && !hasCustom) {
    return join(
      html`<section aria-labelledby="endpoints-h"><h2 id="endpoints-h">Endpoints</h2>`,
      html`<p>No requests or custom measurements were recorded. See the `,
      html`<a href="${`${REPOSITORY_URL}#readme`}" rel="noopener noreferrer">documentation</a>`,
      html` for setting up the measured tests.</p></section>`,
    );
  }
  return [
    hasEndpoints
      ? keyTable('endpoints', data.endpoints, report, level)
      : html`<section aria-labelledby="endpoints-h"><h2 id="endpoints-h">Endpoints</h2><p>No backend requests were recorded.</p></section>`,
    hasCustom ? keyTable('custom', data.custom, report, level) : null,
  ];
}

// ---------------------------------------------------------------------------------------------

/** Content-Security-Policy of the page (11-REQ-23, 11-D-07). */
export const CONTENT_SECURITY_POLICY = `default-src 'none'; script-src 'sha256-${SCRIPT_SHA256}'; style-src 'sha256-${STYLES_SHA256}'; img-src data:`;

/** The complete HTML report of a run report (11). Pure and deterministic (11-REQ-02). */
export function renderHtmlReport(report: RunReport): string {
  const data = toHtmlReportData(report);
  const head = join(
    html`<head><meta charset="utf-8">`,
    html`<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">`,
    html`<meta name="viewport" content="width=device-width, initial-scale=1">`,
    html`<meta name="color-scheme" content="light dark">`,
    html`<meta name="generator" content="${`${PACKAGE_NAME} ${report.tool.version}`}">`,
    html`<link rel="icon" href="data:,"><title>Performance report ${report.runId}</title>`,
    html`<style>${trustedHtml(STYLES)}</style></head>`,
  );
  const download = join(
    html`<div class="toolbar"><button type="button" id="download" hidden>Download JSON (aggregates, without raw samples)</button>`,
    html`<a id="download-link" download="report-data.json" hidden tabindex="-1"></a></div>`,
  );
  const main = join(
    header(report),
    download,
    verdict(report),
    mutedSection(report),
    counters(report),
    issuesSection(report),
    keySections(data, report),
    thresholdsSection(report),
    runConditions(report),
    configuration(report),
  );
  const page = join(
    html`<!doctype html>\n<html lang="en">${head}\n<body><main>${main}</main>${footer(report)}\n`,
    html`<script type="application/json" id="report-data">${trustedHtml(embeddedJson(data))}</script>\n`,
    html`<script>${trustedHtml(SCRIPT)}</script>\n</body></html>\n`,
  );
  return page.text;
}
