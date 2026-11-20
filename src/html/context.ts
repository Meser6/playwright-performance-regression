// What every part of the page needs: the report, the embedded data, the evaluated percentile,
// the default order of the keys and their positions (11-REQ-09, 11-REQ-37).
import type { Check, KeyEvaluation, RunReport } from '../core/types/index.ts';
import { toHtmlReportData } from './data.ts';
import type { HtmlAggregate, HtmlReportData } from './data.ts';
import { html } from './escape.ts';
import type { HtmlValue, SafeHtml } from './escape.ts';

/** Evaluated percentile when the config snapshot omits it: the schema default (03). */
const DEFAULT_PERCENTILE = 'p95';

/** Kind of a key in links and deep links (11-REQ-38); `request` is reserved for 15. */
export type LinkKind = 'api' | 'custom';
export const LINK_KINDS: readonly LinkKind[] = ['api', 'custom'];
/** Order of the kinds in rankings and ties (11-REQ-31). */
export const KIND_ORDER: Record<LinkKind, number> = { api: 0, custom: 2 };
export const KIND_LABEL: Record<LinkKind, string> = { api: 'endpoint', custom: 'custom' };
/** Tab of each kind (11-REQ-26). */
export const KIND_TAB: Record<LinkKind, string> = { api: 'endpoints', custom: 'custom' };

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
  return kind === 'api' ? data.endpoints : data.custom;
}

export function context(report: RunReport): Ctx {
  const data = toHtmlReportData(report);
  const level = report.config.checks?.time?.percentile?.level ?? DEFAULT_PERCENTILE;
  const order = {
    api: defaultOrder(data.endpoints, level),
    custom: defaultOrder(data.custom, level),
  };
  const positions = (keys: string[]) => new Map(keys.map((key, i) => [key, i + 1]));
  return {
    report,
    data,
    level,
    migrated: report.testBreakdown === null,
    order,
    position: { api: positions(order.api), custom: positions(order.custom) },
  };
}

/** `id` of the details block of a key (11-REQ-37); the key itself never becomes an id. */
export function keyAnchor(ctx: Ctx, kind: LinkKind, key: string): string | null {
  const n = ctx.position[kind].get(key);
  return n === undefined ? null : `key-${kind}-${String(n)}`;
}

/** Link to the details of a key; plain text when the key is not in the report. */
export function keyLink(ctx: Ctx, kind: LinkKind, key: string, text: HtmlValue): SafeHtml {
  const anchor = keyAnchor(ctx, kind, key);
  return anchor === null ? html`${text}` : html`<a href="#${anchor}">${text}</a>`;
}
