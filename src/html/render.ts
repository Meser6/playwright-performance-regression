// Static HTML report of one run (11): a pure function of the run report (11-REQ-02). The page is
// complete without JavaScript (11-REQ-03): all tab panels one below the other and key details in
// <details>; the embedded script adds tabs, the key drawer, deep links, search, filters, sorting
// and the download (11-D-10). Styles and script are build-time constants with their SHA-256
// hashes for the Content-Security-Policy (11-REQ-23, 11-REQ-24).
import { PACKAGE_NAME, REPOSITORY_URL } from '../core/types/index.ts';
import type { RunReport } from '../core/types/index.ts';
import { context, join } from './context.ts';
import type { Ctx } from './context.ts';
import { embeddedJson } from './data.ts';
import { html, trustedHtml } from './escape.ts';
import type { HtmlValue, SafeHtml } from './escape.ts';
import { formatDate } from './format.ts';
import { SCRIPT, SCRIPT_SHA256, STYLES, STYLES_SHA256 } from './generated/assets.ts';
import { icon } from './icons.ts';
import { keyTable, pill } from './keys.ts';
import { bannerSection, kpis, overview } from './overview.ts';
import { runTab, warningsTab } from './run.ts';
import { testsTab } from './tests.ts';

export { KEY_COLUMN_MAX } from './keys.ts';
export { defaultOrder, limitRatio, rowGroup } from './context.ts';
export { buildLink } from './run.ts';
export { banner } from './overview.ts';

/** Tabs in their order (11-REQ-26); `api-requests` appears with 15 (D-28). */
export type TabId = 'overview' | 'endpoints' | 'custom' | 'tests' | 'warnings' | 'run';

interface Tab {
  id: TabId;
  label: string;
  count: number | null;
  content: HtmlValue;
}

const DOCS_URL = `${REPOSITORY_URL}#readme`;

function header(report: RunReport): SafeHtml {
  return join(
    html`<header class="top"><div class="wrap top-in">`,
    html`<p class="brand">${icon('logo')}<b>${report.tool.name}</b> <span class="mu">v${report.tool.version}</span></p>`,
    html`<p class="runline"><span><span class="sr">Run ID </span><code>${report.runId}</code></span> <span>${formatDate(report.startedAt)}</span>`,
    report.env === null ? null : html` <span>env <b>${report.env}</b></span>`,
    html` ${pill('p-kind', report.mode)}</p>`,
    html`<p class="dl js-only" hidden><button type="button" class="btn" id="download">Download JSON (aggregates, without raw samples)</button><a id="download-link" download="report-data.json" hidden tabindex="-1"></a></p>`,
    html`</div></header>`,
  );
}

function tabs(ctx: Ctx): Tab[] {
  const report = ctx.report;
  const endpoints = ctx.order.api.length;
  const custom = ctx.order.custom.length;
  const empty = endpoints === 0 && custom === 0;
  const list: Tab[] = [
    { id: 'overview', label: 'Overview', count: null, content: overview(ctx, DOCS_URL) },
    {
      id: 'endpoints',
      label: 'Endpoints',
      count: endpoints,
      content:
        endpoints > 0
          ? keyTable(ctx, 'api', 'Endpoints')
          : empty
            ? html`<p>No requests or custom measurements were recorded. See the <a href="${DOCS_URL}" rel="noopener noreferrer">documentation</a> for setting up the measured tests.</p>`
            : html`<p>No backend requests were recorded.</p>`,
    },
  ];
  if (custom > 0) {
    list.push({
      id: 'custom',
      label: 'Custom',
      count: custom,
      content: keyTable(ctx, 'custom', 'Custom measurements'),
    });
  }
  list.push(
    {
      id: 'tests',
      label: 'Tests',
      count: report.testBreakdown?.tests.length ?? null,
      content: testsTab(ctx),
    },
    {
      id: 'warnings',
      label: 'Warnings',
      count: report.warnings.length + report.toolErrors.length,
      content: warningsTab(report),
    },
    { id: 'run', label: 'Run & config', count: null, content: runTab(report) },
  );
  return list;
}

function tabBar(list: readonly Tab[]): SafeHtml {
  return html`<nav class="tabs" aria-label="Report sections"><div class="tabs-in" data-tabs="">${list.map(
    (t) =>
      html`<a href="#tab-${t.id}" id="tab-${t.id}-link" data-tab="${t.id}">${t.label}${t.count === null ? null : html` <span class="tc">${t.count}</span>`}</a>`,
  )}</div></nav>`;
}

function panel(t: Tab): SafeHtml {
  return html`<section class="panel" id="tab-${t.id}" data-panel="${t.id}" aria-labelledby="tab-${t.id}-h"><h2 class="ph" id="tab-${t.id}-h">${t.label}</h2>${t.content}</section>`;
}

/** The key drawer (11-REQ-37); used only by the script, so hidden in the static page. */
function drawer(): SafeHtml {
  return join(
    html`<aside class="drawer" id="drawer" role="dialog" aria-modal="false" aria-labelledby="drawer-title" hidden>`,
    html`<div class="drawer-head"><h2 id="drawer-title" tabindex="-1">Key details</h2><div class="drawer-nav">`,
    html`<button type="button" class="btn" data-act="prev">Previous key</button><button type="button" class="btn" data-act="next">Next key</button>`,
    html`<button type="button" class="btn" data-copy>Copy link</button>`,
    html`<button type="button" class="btn" data-act="close">Close</button></div></div>`,
    html`<p class="copy-out" hidden><label>Link to this key <input type="text" readonly></label></p>`,
    html`<div class="drawer-body"></div></aside>`,
  );
}

/** Only the project link, without promotional content (11-REQ-20, 11-D-05). */
function footer(report: RunReport): SafeHtml {
  return html`<footer class="wrap">Generated by <a href="${REPOSITORY_URL}" rel="noopener noreferrer">${report.tool.name}</a> v${report.tool.version}</footer>`;
}

/** Content-Security-Policy of the page (11-REQ-23, 11-D-07). */
export const CONTENT_SECURITY_POLICY = `default-src 'none'; script-src 'sha256-${SCRIPT_SHA256}'; style-src 'sha256-${STYLES_SHA256}'; img-src data:`;

/** The complete HTML report of a run report (11). Pure and deterministic (11-REQ-02). */
export function renderHtmlReport(report: RunReport): string {
  const ctx = context(report);
  const list = tabs(ctx);
  const head = join(
    html`<head><meta charset="utf-8">`,
    html`<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">`,
    html`<meta name="viewport" content="width=device-width, initial-scale=1">`,
    html`<meta name="color-scheme" content="light dark">`,
    html`<meta name="generator" content="${`${PACKAGE_NAME} ${report.tool.version}`}">`,
    html`<link rel="icon" href="data:,"><title>Performance report ${report.runId}</title>`,
    html`<style>${trustedHtml(STYLES)}</style></head>`,
  );
  const main = join(
    html`<main id="main" class="wrap">`,
    bannerSection(ctx),
    kpis(ctx),
    tabBar(list),
    html`<p class="status-msg" id="status" role="status"></p>`,
    list.map(panel),
    html`</main>`,
  );
  const page = join(
    html`<!doctype html>\n<html lang="en">${head}\n<body><a class="skip" href="#main">Skip to content</a>`,
    header(report),
    main,
    drawer(),
    footer(report),
    html`\n<script type="application/json" id="report-data">${trustedHtml(embeddedJson(ctx.data))}</script>\n`,
    html`<script>${trustedHtml(SCRIPT)}</script>\n</body></html>\n`,
  );
  return page.text;
}
