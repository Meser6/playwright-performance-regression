// Tests tab: per-test costs (11-REQ-35) and the waterfall of the slowest test runs (11-REQ-36).
import type { TestCost, Waterfall } from '../core/types/index.ts';
import { waterfallSvg } from './charts.ts';
import { join, keyLink } from './context.ts';
import type { Ctx } from './context.ts';
import { html } from './escape.ts';
import type { SafeHtml } from './escape.ts';
import { formatMs, plural, truncateMiddle } from './format.ts';

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

function testRow(ctx: Ctx, t: TestCost, i: number): SafeHtml {
  const share = (ms: number): string =>
    t.totalMs === 0 ? '0%' : `${String(Math.round((ms / t.totalMs) * 100))}%`;
  const more = t.violatedKeyCount - t.violatedKeys.length;
  return join(
    html`<tr data-i="${i}"${t.violatedKeyCount > 0 ? html` data-v=""` : null}><th scope="row">${title(t.title)}<br><small>${where(t)}</small></th>`,
    html`<td>${t.executions}</td><td>${t.requestCount}</td><td>${t.errorCount === 0 ? null : t.errorCount}</td>`,
    html`<td>${formatMs(t.totalMs)}</td><td>${formatMs(perRun(t))}</td>`,
    html`<td>${t.maxRequestMs === null ? '—' : formatMs(t.maxRequestMs)}</td><td>${t.keyCount}</td>`,
    html`<td class="tk">${t.topKeys.map((k, j) => html`${j > 0 ? html`<br>` : null}${keyLink(ctx, 'api', k.key, truncateMiddle(k.key, KEY_MAX))} <small>${formatMs(k.totalMs)} · ${share(k.totalMs)}</small>`)}</td>`,
    html`<td class="tk">${t.violatedKeyCount === 0 ? null : t.violatedKeyCount}`,
    t.violatedKeys.length === 0
      ? null
      : html`${t.violatedKeys.map((k) => html`<br>${keyLink(ctx, 'api', k, truncateMiddle(k, KEY_MAX))}`)}${more > 0 ? html`<br>+${more} more` : null}`,
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
  const header = ([sort, label]: [string, string]): SafeHtml =>
    sort === ''
      ? html`<th scope="col">${label}</th>`
      : html`<th scope="col" data-sort="${sort}"><button type="button">${label}</button></th>`;
  return join(
    html`<p>Total wait is the sum of request durations; parallel requests count in full, so it can exceed the test duration.</p>`,
    html`<div class="tools js-only" data-for="table-tests" hidden>`,
    html`<input type="search" class="search" aria-label="Search tests by title or file" placeholder="Search tests" autocomplete="off">`,
    html`<div class="chips" role="group" aria-label="Violations"><button type="button" class="chip" aria-pressed="false" data-f="v" data-v="">With violations</button></div>`,
    html`<span class="count" role="status" data-count>showing ${tests.length} of ${tests.length}</span></div>`,
    html`<div class="scroll"><table class="tests" id="table-tests"><caption>Tests by total wait: ${plural(tests.length, 'test')}</caption>`,
    html`<thead><tr>${cols.map(header)}</tr></thead><tbody>${tests.map((t, i) => testRow(ctx, t, i))}</tbody></table></div>`,
    omitted > 0
      ? html`<p class="mu">and ${plural(omitted, 'more test')} with a smaller total wait (not stored in the report)</p>`
      : null,
  );
}

function waterfallBlock(w: Waterfall, i: number): SafeHtml {
  return join(
    html`<figure class="wfb"><figcaption><b>${title(w.test.title)}</b><br><small>${where(w.test)} · repeat ${w.test.repeatEachIndex} · total wait ${formatMs(w.totalMs)} · ${plural(w.requestCount, 'request')} · span ${formatMs(w.spanMs)}</small></figcaption>`,
    html`<div class="scroll wfs" tabindex="0" role="region" aria-label="Waterfall ${i + 1}, scrolls sideways">${waterfallSvg(w, `w${String(i + 1)}`)}</div>`,
    w.omitted > 0
      ? html`<p class="mu">and ${plural(w.omitted, 'more request')} not shown</p>`
      : null,
    html`</figure>`,
  );
}

/** Content of the Tests tab. */
export function testsTab(ctx: Ctx): SafeHtml {
  const breakdown = ctx.report.testBreakdown;
  const tool = ctx.report.tool;
  if (breakdown === null) {
    return html`<p>Per-test data is not available: this report was created by ${tool.name} v${tool.version} (report format v1). Re-run the tests with a newer version.</p>`;
  }
  if (breakdown.tests.length === 0) {
    return html`<p>No test made backend requests in measured projects.</p>`;
  }
  return join(
    testsTable(ctx, breakdown.tests, breakdown.omitted),
    breakdown.waterfalls.length === 0
      ? null
      : html`<section aria-labelledby="wf-h"><h3 id="wf-h">Slowest test runs</h3>${breakdown.waterfalls.map(waterfallBlock)}</section>`,
  );
}
