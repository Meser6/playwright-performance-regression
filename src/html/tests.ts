// Tests tab: per-test costs (11-REQ-35) and the waterfall of the slowest test runs (11-REQ-36).
import type { TestCost, Waterfall } from '../core/types/index.ts';
import { waterfallSvg } from './charts.ts';
import { join, keyLink } from './context.ts';
import type { Ctx } from './context.ts';
import { html } from './escape.ts';
import type { SafeHtml } from './escape.ts';
import { formatMs, plural, truncateMiddle } from './format.ts';
import { noMatch, searchBox } from './keys.ts';
import { emptyState, widthClass } from './overview.ts';

/** Test titles longer than this are shortened in the table and the waterfall header. */
export const TITLE_MAX = 100;
/** Keys are shortened in the middle in the Tests table; the link leads to the full key. */
const KEY_MAX = 32;

function title(text: string): SafeHtml {
  const short = truncateMiddle(text, TITLE_MAX);
  return short === text ? html`${text}` : html`<span title="${text}">${short}</span>`;
}

function where(t: { project: string; file: string; line: number }): SafeHtml {
  return html`${t.project === '' ? 'default project' : t.project} · ${t.file}:${t.line}`;
}

/** Average wait per run, rounded to 0.1 ms (02-REQ-07). */
export function perRun(t: Pick<TestCost, 'totalMs' | 'executions'>): number {
  return Math.round((t.totalMs / t.executions) * 10) / 10;
}

function testRow(ctx: Ctx, t: TestCost, i: number, most: number): SafeHtml {
  const share = (ms: number): string =>
    t.totalMs === 0 ? '0%' : `${String(Math.round((ms / t.totalMs) * 100))}%`;
  const more = t.violatedKeyCount - t.violatedKeys.length;
  return join(
    html`<tr data-i="${i}"${t.violatedKeyCount > 0 ? html` data-v=""` : null}><th scope="row" class="tc"><span class="tn">${title(t.title)}</span><span class="sub mono">${where(t)}</span></th>`,
    html`<td class="num">${t.executions}</td><td class="num">${t.requestCount}</td>`,
    t.errorCount === 0 ? html`<td class="num"></td>` : html`<td class="num e">${t.errorCount}</td>`,
    html`<td><span class="hr"><span class="tb neu tw"><span class="${widthClass(most > 0 ? t.totalMs / most : 0)}"></span></span><b>${formatMs(t.totalMs)}</b></span></td>`,
    html`<td class="num">${formatMs(perRun(t))}</td>`,
    html`<td class="num">${t.maxRequestMs === null ? '—' : formatMs(t.maxRequestMs)}</td><td class="num">${t.keyCount}</td>`,
    // Each key on its own line, its time and share below (F2 decision 12).
    html`<td class="tk tk2">${t.topKeys.map((k) => html`<span>${keyLink(ctx, 'api', k.key, KEY_MAX)} <span class="sub">${formatMs(k.totalMs)} · ${share(k.totalMs)}</span></span>`)}</td>`,
    html`<td class="tk">`,
    t.violatedKeyCount === 0
      ? null
      : html`<span class="pill f">${plural(t.violatedKeyCount, 'key')}</span>${t.violatedKeys.map((k) => html`<span>${keyLink(ctx, 'api', k, KEY_MAX)}</span>`)}${more > 0 ? html`<span class="sub">+${more} more</span>` : null}`,
    html`</td></tr>`,
  );
}

function testsTable(ctx: Ctx, tests: readonly TestCost[], omitted: number): SafeHtml {
  const cols: [string, string][] = [
    ['title', 'Test'],
    ['runs', 'Runs'],
    ['requests', 'Requests'],
    ['errors', 'Errors'],
    ['total', 'Total wait'],
    ['avg', 'Avg per run'],
    ['longest', 'Longest request'],
    ['keys', 'Keys'],
    ['', 'Top keys'],
    ['violations', 'Violations'],
  ];
  const numeric = new Set(['runs', 'requests', 'errors', 'avg', 'longest', 'keys']);
  const header = ([sort, label]: [string, string]): SafeHtml =>
    sort === ''
      ? html`<th scope="col">${label}</th>`
      : html`<th scope="col" data-sort="${sort}"${numeric.has(sort) ? html` class="num"` : null}><button type="button">${label}</button></th>`;
  const most = tests.reduce((m, t) => Math.max(m, t.totalMs), 0);
  return join(
    html`<div class="card" data-for="table-tests"><div class="toolbar js-only" hidden>`,
    searchBox('Search tests by title or file', 'Filter tests…'),
    html`<div class="fg" role="group" aria-label="Violations"><button type="button" class="flt" aria-pressed="false" data-f="v" data-v="">With violations</button></div>`,
    html`<span class="count" role="status" data-count>showing ${tests.length} of ${tests.length}</span></div>`,
    html`<div class="scroll" tabindex="0" role="region" aria-label="Tests table"><table class="tests" id="table-tests"><caption>Tests by total wait: ${plural(tests.length, 'test')}</caption>`,
    html`<thead><tr>${cols.map(header)}</tr></thead><tbody>${tests.map((t, i) => testRow(ctx, t, i, most))}</tbody></table></div>`,
    noMatch('No tests match the filters'),
    omitted > 0
      ? html`<p class="tfoot">and ${plural(omitted, 'more test')} with a smaller total wait (not stored in the report)</p>`
      : null,
    html`</div>`,
  );
}

function waterfallCard(w: Waterfall, i: number): SafeHtml {
  return join(
    html`<figure class="card wfb"><figcaption class="wf-h"><div><h4>${title(w.test.title)}</h4><p class="sub mono">${where(w.test)} · repetition ${w.test.repeatEachIndex}</p></div>`,
    html`<dl><div><dt>Span</dt><dd>${formatMs(w.spanMs)}</dd></div><div><dt>Total wait</dt><dd>${formatMs(w.totalMs)}</dd></div><div><dt>Requests</dt><dd>${w.requestCount}</dd></div></dl></figcaption>`,
    html`<div class="scroll wfs" tabindex="0" role="region" aria-label="Waterfall ${i + 1}, scrolls sideways">${waterfallSvg(w, `w${String(i + 1)}`)}</div>`,
    w.omitted > 0
      ? html`<p class="tfoot">and ${plural(w.omitted, 'more request')} not shown</p>`
      : null,
    html`</figure>`,
  );
}

/** Content of the Tests tab. */
export function testsTab(ctx: Ctx): SafeHtml {
  const breakdown = ctx.report.testBreakdown;
  const tool = ctx.report.tool;
  if (breakdown === null) {
    return emptyState(
      'Per-test data is not available',
      `Per-test data is not available: this report was created by ${tool.name} v${tool.version} (report format v1). Re-run the tests with a newer version.`,
      null,
    );
  }
  if (breakdown.tests.length === 0) {
    return emptyState(
      'No per-test costs',
      'No test made backend requests in measured projects.',
      null,
    );
  }
  return join(
    testsTable(ctx, breakdown.tests, breakdown.omitted),
    breakdown.waterfalls.length === 0
      ? null
      : join(
          html`<section aria-labelledby="wf-h"><div class="ph"><h3 id="wf-h">Slowest test runs</h3>`,
          html`<p class="legend"><span><i class="s-acc"></i>2xx/3xx</span><span><i class="s-warn"></i>4xx</span><span><i class="s-bad"></i>5xx · failed</span><span><i class="s-mute"></i>aborted</span></p></div>`,
          html`<div class="wl">${breakdown.waterfalls.map(waterfallCard)}</div></section>`,
        ),
  );
}
