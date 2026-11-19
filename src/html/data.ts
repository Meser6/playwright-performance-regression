// Data embedded in the HTML report (11, chapter 5): the run report without retained durations.
import type { Aggregate, RunReport } from '../core/types/index.ts';

/** Aggregate without `samples.durations`; `samples.retained` holds their count (11-REQ-05). */
export type HtmlAggregate = Omit<Aggregate, 'samples'> & {
  samples: { retained: number; sampled: boolean };
};

/** Data embedded in the page: the run report without retained durations (11-REQ-05, 11-D-01). */
export type HtmlReportData = Omit<RunReport, 'endpoints' | 'custom'> & {
  endpoints: Record<string, HtmlAggregate>;
  custom: Record<string, HtmlAggregate>;
};

function withoutDurations(aggregates: Record<string, Aggregate>): Record<string, HtmlAggregate> {
  const out: Record<string, HtmlAggregate> = {};
  for (const key of Object.keys(aggregates).sort()) {
    const { samples, ...rest } = aggregates[key] as Aggregate;
    out[key] = {
      ...rest,
      samples: { retained: samples.durations.length, sampled: samples.sampled },
    };
  }
  return out;
}

/** The run report with each `samples.durations` replaced by `samples.retained` (11-REQ-05). */
export function toHtmlReportData(report: RunReport): HtmlReportData {
  return {
    ...report,
    endpoints: withoutDurations(report.endpoints),
    custom: withoutDurations(report.custom),
  };
}

function stable(value: unknown, indent: string | null, depth: string): string {
  if (value === null || typeof value !== 'object') {
    // Strings, finite numbers and booleans; undefined object members are skipped below.
    return JSON.stringify(value) ?? 'null';
  }
  const inner = indent === null ? '' : depth + indent;
  const open = indent === null ? '' : `\n${inner}`;
  const close = indent === null ? '' : `\n${depth}`;
  const sep = indent === null ? ',' : `,\n${inner}`;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[${open}${value.map((v) => stable(v, indent, inner)).join(sep)}${close}]`;
  }
  const record = value as Record<string, unknown>;
  // Code-unit order, as in the run report (02-REQ-04); integer-like keys are not reordered.
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  if (keys.length === 0) return '{}';
  const colon = indent === null ? ':' : ': ';
  const entries = keys.map(
    (k) => `${JSON.stringify(k)}${colon}${stable(record[k], indent, inner)}`,
  );
  return `{${open}${entries.join(sep)}${close}}`;
}

/**
 * JSON text with keys sorted by code unit, so the page does not depend on the key order of the
 * object in memory (11-REQ-02). `indent` null gives the compact form.
 */
export function stableJson(value: unknown, indent: string | null = null): string {
  return stable(value, indent, '');
}

/**
 * Text of the `report-data` element (11-REQ-06): compact JSON with every `<` written as `<`,
 * so the data can never close the element.
 */
export function embeddedJson(data: HtmlReportData): string {
  return stableJson(data).replaceAll('<', '\\u003c');
}
