// Static HTML report of one run (11): a pure function of the run report (11-REQ-02). The page is
// complete without JavaScript (11-REQ-03): all tab panels one below the other and key details in
// <details>; the embedded script adds tabs, the key dialog, deep links, search, filters, sorting
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
import { FAVICON_URI, icon, iconSprite, logo } from './icons.ts';
import { keyTable } from './keys.ts';
import { badge, emptyState, kpis, overview, verdictCard } from './overview.ts';
import { runTab, warningsTab } from './run.ts';
import { testsTab } from './tests.ts';

export { KEY_COLUMN_MAX } from './keys.ts';
export { defaultOrder, limitRatio, rowGroup } from './context.ts';
export { buildLink } from './run.ts';
export { banner } from './overview.ts';

/** Tabs in their order (11-REQ-26); `api-requests` appears with 15 (D-28). */
export type TabId = 'overview' | 'endpoints' | 'steps' | 'tests' | 'warnings' | 'run';

interface Tab {
  id: TabId;
  label: string;
  count: number | null;
  /** Badge tone (11-REQ-50): red for violations, orange for warnings. */
  tone: string;
  /** A sentence next to the panel heading. */
  note: HtmlValue;
  content: HtmlValue;
}

const DOCS_URL = `${REPOSITORY_URL}#readme`;

function chip(name: Parameters<typeof icon>[0], content: HtmlValue): SafeHtml {
  return html`<span class="chip">${icon(name)}${content}</span>`;
}

/** The app bar (11-REQ-49). */
function header(report: RunReport): SafeHtml {
  const ci = report.ci;
  return join(
    html`<header class="appbar"><div class="wrap">`,
    html`<p class="brand">${logo()}<b>${report.tool.name}</b> <span class="ver">v${report.tool.version}</span></p>`,
    // Focusable: the chips scroll sideways on narrow screens (11-REQ-18).
    html`<div class="meta" role="group" aria-label="Run details" tabindex="0">`,
    report.env === null ? null : chip('env', html`env <b>${report.env}</b>`),
    chip('play', html`mode <b>${report.mode}</b>`),
    chip('clock', html`<b>${formatDate(report.startedAt).slice(0, -4)}</b> UTC`),
    ci === null || (ci.branch === null && ci.commit === null)
      ? null
      : chip(
          'branch',
          html`<b>${ci.branch ?? 'commit'}</b>${ci.commit === null ? null : html` @ ${ci.commit.slice(0, 7)}`}`,
        ),
    html`<span class="chip mono"><span class="sr">Run ID </span>${report.runId}</span></div>`,
    html`<p class="js-only" hidden><button type="button" class="btn" id="download" aria-label="Download JSON (aggregates, without raw samples)">${icon('dl')}<span>Download JSON</span></button><a id="download-link" download="report-data.json" hidden tabindex="-1"></a></p>`,
    html`</div></header>`,
  );
}

function failing(ctx: Ctx, kind: 'api' | 'step'): boolean {
  const data = kind === 'api' ? ctx.data.endpoints : ctx.data.steps;
  return Object.values(data).some((a) => a.evaluation.result === 'fail');
}

function tabs(ctx: Ctx): Tab[] {
  const report = ctx.report;
  const endpoints = ctx.order.api.length;
  const steps = ctx.order.step.length;
  const empty = endpoints === 0 && steps === 0;
  const issues = report.warnings.length + report.toolErrors.length;
  const list: Tab[] = [
    {
      id: 'overview',
      label: 'Overview',
      count: null,
      tone: '',
      note: null,
      content: overview(ctx, DOCS_URL),
    },
    {
      id: 'endpoints',
      label: 'Endpoints',
      count: endpoints,
      tone: failing(ctx, 'api') ? 'bad' : '',
      note: 'Browser requests and request calls to measured origins, worst first.',
      content:
        endpoints > 0
          ? keyTable(ctx, 'api', 'Endpoints')
          : empty
            ? emptyState(
                'No requests or steps were recorded',
                'The measured projects made no requests to the measured origins.',
                DOCS_URL,
              )
            : emptyState(
                'No backend requests were recorded',
                'The measured tests made no requests to the measured origins.',
                null,
              ),
    },
  ];
  // Only a report with step keys has the Steps tab (11-REQ-47).
  if (steps > 0) {
    list.push({
      id: 'steps',
      label: 'Steps',
      count: steps,
      tone: failing(ctx, 'step') ? 'bad' : '',
      note: html`<code>test.step</code> durations, grouped by step path across tests.`,
      content: keyTable(ctx, 'step', 'Steps'),
    });
  }
  list.push(
    {
      id: 'tests',
      label: 'Tests',
      count: report.testBreakdown?.tests.length ?? null,
      tone: '',
      note:
        (report.testBreakdown?.tests.length ?? 0) > 0
          ? 'Total wait is the sum of request durations; parallel requests count in full, so it can exceed the test duration.'
          : null,
      content: testsTab(ctx),
    },
    {
      id: 'warnings',
      label: 'Warnings',
      count: issues,
      tone: issues > 0 ? 'warn' : '',
      note:
        report.toolErrors.length === 0
          ? 'No tool errors.'
          : `${String(report.toolErrors.length)} tool ${report.toolErrors.length === 1 ? 'error' : 'errors'}.`,
      content: warningsTab(report),
    },
    {
      id: 'run',
      label: 'Run & config',
      count: null,
      tone: '',
      note: null,
      content: runTab(report),
    },
  );
  return list;
}

/** The sticky segmented tab bar (11-REQ-50); links to the panels without the script. */
function tabBar(list: readonly Tab[]): SafeHtml {
  return html`<nav class="tabs" aria-label="Report sections"><div class="seg" data-tabs="">${list.map(
    (t) =>
      html`<a href="#tab-${t.id}" id="tab-${t.id}-link" data-tab="${t.id}">${t.label}${t.count === null ? null : html` ${badge(t.count, t.tone)}`}</a>`,
  )}</div></nav>`;
}

function panel(t: Tab): SafeHtml {
  // Overview and Run & config need no visible heading with the script (the tab names them).
  const quiet = t.note === null ? ' js-sr' : '';
  return html`<section class="panel" id="tab-${t.id}" data-panel="${t.id}" aria-labelledby="tab-${t.id}-h"><div class="ph${quiet}"><h2 id="tab-${t.id}-h">${t.label}</h2>${t.note === null ? null : html`<p>${t.note}</p>`}</div>${t.content}</section>`;
}

/**
 * The key dialog (11-REQ-37): a native <dialog> opened with showModal() by the script; closed, it
 * is not rendered, so the static page has no dead buttons.
 */
function keyDialog(): SafeHtml {
  return join(
    html`<dialog class="kdlg" id="key-dialog" aria-labelledby="dlg-title">`,
    html`<div class="dh"><div class="nav"><span class="sub" id="dlg-pos"></span>`,
    html`<button type="button" class="btn icon sm" data-act="prev" aria-label="Previous key">${icon('l')}</button>`,
    html`<button type="button" class="btn icon sm" data-act="next" aria-label="Next key">${icon('r')}</button>`,
    html`<button type="button" class="btn icon sm" data-act="close" aria-label="Close">${icon('x')}</button></div>`,
    html`<h2 id="dlg-title" tabindex="-1">Key details</h2><div class="dh-slot"></div></div>`,
    html`<div class="db"></div>`,
    html`<div class="dfoot"><button type="button" class="btn sm" data-copy>${icon('link')}Copy link</button>`,
    html`<p class="copy-out" hidden><label>Link to this key <input type="text" readonly></label></p></div>`,
    html`</dialog>`,
  );
}

/** Only the project link, without promotional content (11-REQ-20, 11-D-05). */
function footer(report: RunReport): SafeHtml {
  return html`<footer><div class="wrap">Generated by <a href="${REPOSITORY_URL}" rel="noopener noreferrer">${report.tool.name}</a> v${report.tool.version}</div></footer>`;
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
    html`<link rel="icon" type="image/svg+xml" href="${FAVICON_URI}"><title>Performance report ${report.runId}</title>`,
    html`<style>${trustedHtml(STYLES)}</style></head>`,
  );
  const main = join(
    html`<main id="main" class="wrap">`,
    verdictCard(ctx),
    kpis(ctx),
    tabBar(list),
    html`<p class="status-msg" id="status" role="status"></p>`,
    list.map(panel),
    html`</main>`,
  );
  const page = join(
    html`<!doctype html>\n<html lang="en">${head}\n<body><a class="skip" href="#main">Skip to content</a>`,
    iconSprite(),
    header(report),
    main,
    keyDialog(),
    footer(report),
    html`\n<script type="application/json" id="report-data">${trustedHtml(embeddedJson(ctx.data))}</script>\n`,
    html`<script>${trustedHtml(SCRIPT)}</script>\n</body></html>\n`,
  );
  return page.text;
}
