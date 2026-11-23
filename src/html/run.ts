// Warnings tab (11-REQ-45) and Run & config tab (11-REQ-46), as cards (11-REQ-56, 11-REQ-57).
import type { Issue, RunReport, ThresholdFileInfo } from '../core/types/index.ts';
import { DASH, join } from './context.ts';
import { stableJson } from './data.ts';
import { html } from './escape.ts';
import type { HtmlValue, SafeHtml } from './escape.ts';
import { formatDate, formatRunDuration, plural } from './format.ts';
import { icon } from './icons.ts';
import { pill } from './keys.ts';
import { emptyState } from './overview.ts';

function issueCard(i: Issue, level: 'error' | 'warning'): SafeHtml {
  const error = level === 'error';
  return join(
    html`<article class="card wn${error ? ' err' : ''}"><span class="wi">${icon(error ? 'bad' : 'warn')}</span>`,
    html`<code>${i.code}</code><span class="n ${error ? 'bad' : 'warn'}">×${i.count ?? 1}</span>`,
    html`<p><span class="sr">${error ? 'Tool error' : 'Warning'}: </span>${i.message}</p>`,
    i.hint === undefined ? null : html`<p class="hint">${icon('info')}<span>${i.hint}</span></p>`,
    html`</article>`,
  );
}

/** Tool errors first, then warnings; tool errors highlighted on an error status (11-REQ-45). */
export function warningsTab(report: RunReport): SafeHtml {
  const { warnings, toolErrors } = report;
  if (warnings.length === 0 && toolErrors.length === 0) {
    return emptyState('No warnings', 'No warnings or tool errors.', null);
  }
  const highlight = report.evaluation.status === 'error' ? ' hl-err' : '';
  return join(
    toolErrors.length === 0
      ? null
      : html`<section class="wl${highlight}" aria-labelledby="errors-h"><h3 id="errors-h" class="sh">Tool errors (${toolErrors.length})</h3>${toolErrors.map((i) => issueCard(i, 'error'))}</section>`,
    warnings.length === 0
      ? null
      : html`<section class="wl" aria-labelledby="warnings-h"><h3 id="warnings-h" class="sh">Warnings (${warnings.length})</h3>${warnings.map((i) => issueCard(i, 'warning'))}</section>`,
  );
}

/** ci.buildUrl is a link only for http(s) URLs; any other value is text (11-REQ-22a). */
export function buildLink(url: string | null): HtmlValue {
  if (url === null) return DASH;
  return /^https?:\/\//iu.test(url.trimStart())
    ? html`<a href="${url}" rel="noopener noreferrer">${url}</a>`
    : html`<code>${url}</code>`;
}

/** Label and value list in two columns (11-REQ-46). */
function facts(items: readonly [string, HtmlValue][]): SafeHtml {
  return html`<dl class="kvl">${items.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`;
}

function card(id: string, title: string, ...content: HtmlValue[]): SafeHtml {
  return html`<section aria-labelledby="${id}"><div class="ph"><h3 id="${id}">${title}</h3></div><div class="card">${content}</div></section>`;
}

function runSection(report: RunReport): SafeHtml {
  const { ci, host } = report;
  const items: [string, HtmlValue][] = [
    ...(report.suite === undefined
      ? []
      : [
          [
            'Suite',
            html`<code>${report.suite.name}</code> (${report.suite.source === 'package' ? 'package name' : 'config path'})`,
          ] as [string, HtmlValue],
        ]),
    ['Package', html`<code>${report.tool.name} v${report.tool.version}</code>`],
    ['Run ID', html`<code>${report.runId}</code>`],
    ['Started', formatDate(report.startedAt)],
    ['Finished', formatDate(report.finishedAt)],
    ['Duration', formatRunDuration(report.startedAt, report.finishedAt)],
    ['Mode', `${report.mode} (gate ${report.evaluation.gateEnabled ? 'on' : 'off'})`],
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
  return card('run-h', 'Run', facts(items));
}

function originsSection(report: RunReport): SafeHtml {
  return card(
    'origins-h',
    'Origins',
    report.origins.length === 0
      ? html`<p class="card-p">No request was measured.</p>`
      : facts(
          report.origins.map((o) => [
            o.label === '' ? 'base' : o.label,
            html`<code>${o.origin}</code> · ${plural(o.requestCount, 'request')}`,
          ]),
        ),
  );
}

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

/**
 * Source of a thresholds file shortened to the version and the date, the full text in `title`
 * (11-REQ-46, F2 decision 9): the full one overflowed the card at 1280 px.
 */
function sourceCell(file: ThresholdFileInfo): SafeHtml {
  const full = generatedSource(file);
  const generated = file.generated;
  if (generated === null) return html`<td>${full}</td>`;
  const version = textOf(field(field(generated, 'tool'), 'version'));
  const at = textOf(field(generated, 'sourceRunStartedAt'));
  const short = [
    version === null ? 'generated' : `generated v${version}`,
    ...(at === null ? [] : [formatDate(at).slice(0, 10)]),
  ].join(' · ');
  return html`<td title="${full}">${short}</td>`;
}

function thresholdsFileRow(file: ThresholdFileInfo, report: RunReport): SafeHtml {
  const percentile = textOf(field(file.generated, 'evaluatedPercentile'));
  const fingerprint = textOf(field(file.generated, 'normalization'));
  let normalization: SafeHtml;
  if (fingerprint === null) normalization = html`run <code>${report.normalization}</code>`;
  else if (fingerprint === report.normalization)
    normalization = html`<code>${fingerprint}</code> matches this run`;
  else
    normalization = html`file <code>${fingerprint}</code>, run <code>${report.normalization}</code> ${pill('w', 'differs: keys may not match')}`;
  const status =
    file.status === 'loaded'
      ? pill('p', 'loaded')
      : file.status === 'invalid'
        ? pill('fb', 'invalid')
        : pill('ne', 'missing');
  const unseen = file.unseenKeys;
  return join(
    html`<tr><td>${file.kind}</td><td class="loc">${file.path}</td>`,
    html`<td>${status}</td><td>${percentile ?? DASH}</td>`,
    sourceCell(file),
    html`<td>${normalization}</td><td>`,
    unseen.length === 0
      ? '0'
      : html`<details><summary>${plural(unseen.length, 'key')}</summary><ul class="plain">${unseen.map((k) => html`<li><code>${k}</code></li>`)}</ul></details>`,
    html`</td></tr>`,
  );
}

function thresholdsSection(report: RunReport): SafeHtml {
  const files = report.thresholdFiles;
  return card(
    'thresholds-h',
    'Thresholds files',
    files.length === 0
      ? html`<p class="card-p">No thresholds files were loaded in this run.</p>`
      : join(
          html`<div class="scroll" tabindex="0" role="region" aria-label="Thresholds files table"><table><caption>Thresholds files of this run</caption><thead><tr>`,
          html`<th scope="col">Kind</th><th scope="col">Path</th><th scope="col">Status</th>`,
          html`<th scope="col">Percentile</th><th scope="col">Source</th>`,
          html`<th scope="col">Normalization fingerprint</th><th scope="col">Unseen keys</th>`,
          html`</tr></thead><tbody>${files.map((f) => thresholdsFileRow(f, report))}</tbody></table></div>`,
        ),
  );
}

/** Passes of the run (D-39, 02-REQ-37), e.g. "5 passes" or "4 of 5 passes (no data: pass 3)". */
function passesText(passes: RunReport['passes']): string {
  const done =
    passes.completed === passes.planned
      ? plural(passes.planned, 'pass', 'passes')
      : `${String(passes.completed)} of ${plural(passes.planned, 'pass', 'passes')}`;
  const failed =
    passes.failed.length === 0
      ? ''
      : ` (no data: ${passes.failed.length === 1 ? 'pass' : 'passes'} ${passes.failed.join(', ')})`;
  return `${done}${failed}`;
}

function conditionsSection(report: RunReport): SafeHtml {
  const rc = report.runConditions;
  const overridden =
    rc.overriddenSettings.length === 0
      ? 'none'
      : rc.overriddenSettings.map((s, i) => html`${i > 0 ? ', ' : ''}<code>${s}</code>`);
  const project = (p: RunReport['runConditions']['projects'][number]): SafeHtml =>
    join(
      html`<tr><th scope="row">${p.name === '' ? '(default)' : p.name}</th><td>${p.role}</td>`,
      html`<td>${p.requestOnly === true ? 'no browser' : (p.browserName ?? DASH)}</td><td class="num">${p.repeatEach}</td><td class="num">${p.retries}</td></tr>`,
    );
  return card(
    'conditions-h',
    'Run conditions',
    facts([
      ['Passes', passesText(report.passes)],
      ['Workers', String(rc.workers)],
      ['Overridden by withPerf()', overridden],
    ]),
    rc.projects.length === 0
      ? null
      : join(
          html`<div class="scroll" tabindex="0" role="region" aria-label="Projects table"><table><caption>Projects</caption><thead><tr>`,
          html`<th scope="col">Project</th><th scope="col">Role</th><th scope="col">Browser</th>`,
          html`<th scope="col" class="num">repeatEach</th><th scope="col" class="num">retries</th>`,
          html`</tr></thead><tbody>${rc.projects.map(project)}</tbody></table></div>`,
        ),
  );
}

function configurationSection(report: RunReport): SafeHtml {
  return join(
    html`<section aria-labelledby="config-h"><div class="ph"><h3 id="config-h">Configuration</h3></div>`,
    html`<details class="card cfg"><summary>Configuration snapshot (JSON)</summary>`,
    html`<pre><code>${stableJson(report.config, '  ')}</code></pre></details></section>`,
  );
}

/** Content of the Run & config tab (11-REQ-46). */
export function runTab(report: RunReport): SafeHtml {
  return join(
    html`<div class="grid2"><div>`,
    runSection(report),
    html`</div><div>`,
    originsSection(report),
    conditionsSection(report),
    html`</div></div>`,
    thresholdsSection(report),
    configurationSection(report),
  );
}
