// What every part of the page needs: the report, the embedded data, the evaluated percentile,
// the default order of the keys and their positions (11-REQ-09, 11-REQ-37).
import type { Check, KeyEvaluation, RunReport } from '../core/types/index.ts';
import { toHtmlReportData } from './data.ts';
import type { HtmlAggregate, HtmlReportData } from './data.ts';
import { html } from './escape.ts';
import type { HtmlValue, SafeHtml } from './escape.ts';
import { keyView } from './keyview.ts';

/** Evaluated percentile when the config snapshot omits it: the schema default (03). */
const DEFAULT_PERCENTILE = 'p95';

/** Kind of a key in links and deep links (11-REQ-38); `request` is reserved for 15. */
export type LinkKind = 'api' | 'step';
export const LINK_KINDS: readonly LinkKind[] = ['api', 'step'];
/** Order of the kinds in rankings and ties (11-REQ-31); 1 is reserved for `request`. */
export const KIND_ORDER: Record<LinkKind, number> = { api: 0, step: 2 };
export const KIND_LABEL: Record<LinkKind, string> = { api: 'endpoint', step: 'step' };
/** Tab of each kind (11-REQ-26, 11-REQ-47). */
export const KIND_TAB: Record<LinkKind, string> = { api: 'endpoints', step: 'steps' };
/** Name of each kind in filter chips and table columns. */
export const KIND_NAME: Record<LinkKind, string> = { api: 'Endpoints', step: 'Steps' };
export const KIND_COLUMN: Record<LinkKind, string> = { api: 'API', step: 'Steps' };

export const DASH = '—';

type KeyFacts = Pick<HtmlAggregate, 'stats' | 'evaluation'>;

/** Concatenates template parts; lets long markup be written one piece per line. */
export function join(...parts: HtmlValue[]): SafeHtml {
  return html`${parts}`;
}

/** Code unit order, never localeCompare (02-REQ-04). */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isBlocking(evaluation: Pick<KeyEvaluation, 'result' | 'checks'>): boolean {
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
    return compareText(a.key, b.key);
  });
  return rows.map((r) => r.key);
}

/**
 * The check with the largest usage of a key (11-REQ-30), null counting as infinity; on equal
 * usage the first check. Undefined for a key without checks.
 */
export function topCheck(checks: readonly Check[]): Check | undefined {
  let top: Check | undefined;
  for (const check of checks) {
    const usage = check.usage ?? Infinity;
    if (top === undefined || usage > (top.usage ?? Infinity)) top = check;
  }
  return top;
}

export interface Ctx {
  report: RunReport;
  data: HtmlReportData;
  level: string;
  /** Report migrated from format version 1 (11-REQ-44). */
  migrated: boolean;
  /** Keys of each kind in the default order. */
  order: Record<LinkKind, string[]>;
  /** Key → position in the default order, from 1 (11-REQ-37). */
  position: Record<LinkKind, Map<string, number>>;
}

export function aggregatesOf(data: HtmlReportData, kind: LinkKind): Record<string, HtmlAggregate> {
  const byKind: Record<LinkKind, Record<string, HtmlAggregate>> = {
    api: data.endpoints,
    step: data.steps,
  };
  return byKind[kind];
}

export function context(report: RunReport): Ctx {
  const data = toHtmlReportData(report);
  const level = report.config.checks?.time?.percentile?.level ?? DEFAULT_PERCENTILE;
  const order = {
    api: defaultOrder(data.endpoints, level),
    step: defaultOrder(data.steps, level),
  };
  const positions = (keys: string[]) => new Map(keys.map((key, i) => [key, i + 1]));
  return {
    report,
    data,
    level,
    migrated: report.testBreakdown === null,
    order,
    position: { api: positions(order.api), step: positions(order.step) },
  };
}

/** `id` of the details block of a key (11-REQ-37); the key itself never becomes an id. */
export function keyAnchor(ctx: Ctx, kind: LinkKind, key: string): string | null {
  const n = ctx.position[kind].get(key);
  return n === undefined ? null : `key-${kind}-${String(n)}`;
}

/** Keys longer than this are shortened in the middle in tables and lists (11, chapter 6.4). */
export const KEY_COLUMN_MAX = 80;

/**
 * Link to the details of a key with the key view of 11-REQ-53, shortened to `max` code points;
 * the view without a link when the key is not in the report.
 */
export function keyLink(ctx: Ctx, kind: LinkKind, key: string, max = KEY_COLUMN_MAX): SafeHtml {
  const anchor = keyAnchor(ctx, kind, key);
  const view = keyView(kind, key, max);
  return anchor === null
    ? html`<span class="kl">${view}</span>`
    : html`<a class="kl" href="#${anchor}">${view}</a>`;
}
