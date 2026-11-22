// Static SVG charts of the HTML report (11-REQ-42): the histogram of a key (11-REQ-32), the TTFB
// split (11-REQ-33) and the waterfall of a test run (11-REQ-36). Colours come from CSS classes;
// coordinates are rounded to 0.1; no style attributes, scripts or events. Positions are linear
// inside a bin, so no Math.log is needed (the result does not depend on the engine).
import type { Waterfall } from '../core/types/index.ts';
import { html } from './escape.ts';
import type { SafeHtml } from './escape.ts';
import { formatMs, plural, truncateMiddle } from './format.ts';
import { splitEndpoint } from './keyview.ts';

/** Concatenates SVG parts. */
function join2(...parts: (SafeHtml | null)[]): SafeHtml {
  return html`${parts}`;
}

/** Coordinates are rounded to 0.1 (11-REQ-42). */
function r(x: number): number {
  return Math.round(x * 10) / 10;
}

// ---------------------------------------------------------------------------------------------
// Label placement shared by the charts

/** Height of one label row and the estimated width of one character at the label font size. */
const ROW = 13;
const CHAR = 6.2;
const GAP = 6;

export interface Mark {
  label: string;
  value: number;
  /** Value outside the drawn range: drawn at the edge, the label gets an arrow. */
  side?: 'left' | 'right';
  limit?: boolean;
}

interface Placed extends Mark {
  text: string;
  x: number;
  row: number;
  anchor: 'start' | 'middle' | 'end';
}

/** Marks with the same position share one label, e.g. `p95, p99 250 ms`. */
function merge(marks: readonly (Mark & { x: number })[]): (Mark & { x: number })[] {
  const out: (Mark & { x: number })[] = [];
  for (const mark of marks) {
    const same = out.find((m) => m.x === mark.x && m.limit === mark.limit);
    if (same === undefined) out.push({ ...mark });
    else same.label = `${same.label}, ${mark.label}`;
  }
  return out;
}

/** Puts each label on the first row where it does not overlap the labels already there. */
function place(marks: readonly (Mark & { x: number })[], width: number): Placed[] {
  const rowsEnd: number[] = [];
  return [...marks]
    .sort((a, b) => a.x - b.x)
    .map((mark) => {
      const arrowLeft = mark.side === 'left' ? '← ' : '';
      const arrowRight = mark.side === 'right' ? ' →' : '';
      const text = `${arrowLeft}${mark.label} ${formatMs(mark.value)}${arrowRight}`;
      const w = text.length * CHAR;
      const anchor = mark.x - w / 2 < 0 ? 'start' : mark.x + w / 2 > width ? 'end' : 'middle';
      const from = anchor === 'start' ? mark.x : anchor === 'end' ? mark.x - w : mark.x - w / 2;
      let row = rowsEnd.findIndex((end) => end + GAP <= from);
      if (row === -1) row = rowsEnd.length;
      rowsEnd[row] = from + w;
      return { ...mark, text, row, anchor };
    });
}

/** Text anchors as classes (CSS text-anchor), shorter than the attribute. */
const ANCHOR: Record<Placed['anchor'], string> = { start: 'as', middle: 'am', end: 'ae' };

// ---------------------------------------------------------------------------------------------
// Histogram (11-REQ-32)

const H_WIDTH = 640;
const H_LEFT = 8;
const H_RIGHT = 632;
const H_BARS = 72;

export interface HistogramInput {
  edges: readonly number[];
  counts: readonly number[];
  /** p50, the evaluated percentile and p99, in this order. */
  markers: readonly Mark[];
  /** Limit of the evaluated percentile; null when unknown. */
  limit: Mark | null;
  retained: number;
  sampled: boolean;
}

/** x of a value: linear inside its bin; outside the edges at the edge, with the side. */
export function histogramX(
  edges: readonly number[],
  value: number,
): { x: number; side?: 'left' | 'right' } {
  const bins = edges.length - 1;
  const width = (H_RIGHT - H_LEFT) / bins;
  const first = edges[0] ?? 0;
  const last = edges[bins] ?? 0;
  if (value < first) return { x: H_LEFT, side: 'left' };
  if (value >= last) return value === last ? { x: H_RIGHT } : { x: H_RIGHT, side: 'right' };
  let i = 0;
  while (i < bins - 1 && (edges[i + 1] ?? 0) <= value) i++;
  const lo = edges[i] ?? 0;
  const hi = edges[i + 1] ?? lo;
  return { x: r(H_LEFT + (i + (value - lo) / (hi - lo)) * width) };
}

/** Text of an edge on the axis. */
function edgeText(value: number): string {
  return formatMs(value);
}

/** The histogram SVG of one key (11-REQ-32). */
export function histogramSvg(input: HistogramInput): SafeHtml {
  const { edges, counts } = input;
  const bins = counts.length;
  const width = (H_RIGHT - H_LEFT) / bins;
  const most = Math.max(1, ...counts);
  const marks = [...input.markers, ...(input.limit === null ? [] : [input.limit])].map((m) => {
    const at = histogramX(edges, m.value);
    return { ...m, x: at.x, ...(at.side === undefined ? {} : { side: at.side }) };
  });
  const placed = place(merge(marks), H_WIDTH);
  const rows = Math.max(1, ...placed.map((p) => p.row + 1));
  const top = 4 + ROW * rows;
  const base = top + H_BARS;
  const height = base + 16;

  // Two outlines, one horizontal step per bin (also empty bins), heights linear in the counts:
  // `bars` for the bins below the limit of the evaluated percentile and `bars-hi` for the bins
  // whose lower edge is at or above it (11-REQ-32). The bins above the limit are a suffix,
  // because the edges grow.
  const limitValue = input.limit?.value ?? null;
  let split = bins;
  if (limitValue !== null) {
    const at = edges.findIndex((e, i) => i < bins && e >= limitValue);
    if (at !== -1) split = at;
  }
  const outline = (from: number, to: number): string => {
    let previous = base;
    const steps = counts
      .slice(from, to)
      .map((count) => {
        const y = r(base - (H_BARS * count) / most);
        // A bin as high as the previous one needs no vertical step.
        const step = y === previous ? '' : `V${y}`;
        previous = y;
        return `${step}h${r(width)}`;
      })
      .join('');
    return `M${r(H_LEFT + from * width)} ${base}${steps}V${base}Z`;
  };
  const bars = join2(
    split > 0 ? html`<path class="bars" d="${outline(0, split)}"/>` : null,
    split < bins ? html`<path class="bars-hi" d="${outline(split, bins)}"/>` : null,
  );
  const grid = html`<path class="gr" d="M${H_LEFT} ${top}H${H_RIGHT}M${H_LEFT} ${r(top + H_BARS / 2)}H${H_RIGHT}"/>`;
  const markSvg = placed.map((m) => {
    const y = top - 3 - ROW * (rows - 1 - m.row);
    return html`<path class="${m.limit === true ? 'hl' : 'hm'}" d="M${m.x} ${y + 2}V${base}"/><text class="${ANCHOR[m.anchor]}" x="${m.x}" y="${y}">${m.text}</text>`;
  });

  // Axis labels: first and last edge and powers of 10 inside the range.
  const ticks: { x: number; text: string; anchor: string }[] = [];
  const first = edges[0] ?? 0;
  const last = edges[bins] ?? 0;
  ticks.push({ x: H_LEFT, text: edgeText(first), anchor: 'start' });
  for (let p = 1; p < last; p *= 10) {
    if (p <= first) continue;
    const { x } = histogramX(edges, p);
    if (x - H_LEFT < 40 || H_RIGHT - x < 40) continue;
    ticks.push({ x, text: edgeText(p), anchor: 'middle' });
  }
  ticks.push({ x: H_RIGHT, text: edgeText(last), anchor: 'end' });
  const tickSvg = html`<g class="ht">${ticks.map(
    (t) =>
      html`<text class="${ANCHOR[t.anchor as Placed['anchor']]}" x="${t.x}" y="${height - 3}">${t.text}</text>`,
  )}</g>`;

  // The bin with the most samples (the first of equal ones) for the summary.
  const peak = counts.indexOf(Math.max(...counts));
  const summary = [
    `Histogram of ${plural(input.retained, 'duration')} from ${formatMs(first)} to ${formatMs(last)}`,
    `most (${String(counts[peak] ?? 0)}) in ${formatMs(edges[peak] ?? 0)}–${formatMs(edges[peak + 1] ?? 0)}`,
    marks.map((m) => `${m.label} ${formatMs(m.value)}`).join(', '),
  ].join('; ');
  const label = input.sampled ? `${summary}; uniform sample of ${String(input.retained)}` : summary;
  return html`<svg class="hist ch" viewBox="0 0 ${H_WIDTH} ${height}" role="img" aria-label="${label}">${grid}${bars}<path class="ha" d="M${H_LEFT} ${base}H${H_RIGHT}"/>${markSvg}${tickSvg}</svg>`;
}

// ---------------------------------------------------------------------------------------------
// TTFB split (11-REQ-33)

/** Two segments proportional to TTFB p50 and the p50 of the rest of the duration. */
export function ttfbSplitSvg(ttfb: number, other: number): SafeHtml | null {
  const total = ttfb + other;
  if (total <= 0) return null;
  const width = r((H_WIDTH * ttfb) / total);
  const label = `TTFB p50 ${formatMs(ttfb)}, rest ${formatMs(other)}`;
  return html`<svg class="split" viewBox="0 0 ${H_WIDTH} 16" role="img" aria-label="${label}"><rect class="st" width="${width}" height="16"/><rect class="so" x="${width}" width="${r(H_WIDTH - width)}" height="16"/></svg>`;
}

// ---------------------------------------------------------------------------------------------
// Waterfall (11-REQ-36)

const W_WIDTH = 960;
/** Labels from 0: the method at 0, the rest of the key at W_PATH; bars from W_LEFT to W_RIGHT. */
const W_PATH = 52;
const W_SEP = 340;
const W_LEFT = 350;
const W_RIGHT = 880;
const W_ROW = 20;
const W_TOP = 24;
/** Keys are shortened in the middle to this many characters in the waterfall. */
export const WATERFALL_KEY_MAX = 48;

/** Colour class of a status label: error, warning, muted or neutral (11-REQ-36). */
export function waterfallClass(status: string): 'we' | 'ww' | 'wm' | 'wn' {
  if (status === 'FAILED' || status === 'PENDING' || status.startsWith('5')) return 'we';
  if (status.startsWith('4')) return 'ww';
  return status === 'ABORTED' ? 'wm' : 'wn';
}

/**
 * The waterfall SVG of one test run; `id` makes the ids of its labels unique in the page. Each
 * distinct key label is written once in <defs> and placed in its rows with <use>, which keeps a
 * run that calls the same endpoints many times small (11-REQ-43).
 */
export function waterfallSvg(waterfall: Waterfall, id: string): SafeHtml {
  const span = waterfall.spanMs > 0 ? waterfall.spanMs : 1;
  const scale = (W_RIGHT - W_LEFT) / span;
  const x = (ms: number): number => r(W_LEFT + ms * scale);
  const rows = waterfall.requests;
  const height = W_TOP + rows.length * W_ROW + 4;
  const ticks = [0, 1, 2, 3, 4].map((q) => {
    const value = (waterfall.spanMs * q) / 4;
    const anchor: Placed['anchor'] = q === 0 ? 'start' : q === 4 ? 'end' : 'middle';
    return html`<text class="wt ${ANCHOR[anchor]}" x="${x(value)}" y="12">+${formatMs(value)}</text><path class="wg" d="M${x(value)} 16V${height}"/>`;
  });
  let longest: Waterfall['requests'][number] | null = null;
  // One label per distinct key: method in its colour, then origin and path (11-REQ-53).
  const labels = new Map<string, { ref: string; svg: SafeHtml }>();
  for (const req of rows) {
    if (labels.has(req.key)) continue;
    const { method, origin, path, request } = splitEndpoint(req.key);
    const rest = truncateMiddle(
      `${request ? 'request ' : ''}${origin}${path}`,
      Math.max(8, WATERFALL_KEY_MAX - method.length - 1),
    );
    const parts = rest.split(/(?<=\/)(:[A-Za-z][\w-]*)/u);
    const ref = `${id}-${String(labels.size)}`;
    labels.set(req.key, {
      ref,
      svg: html`<text id="${ref}"><tspan class="wkm m${method}">${method}</tspan><tspan x="${W_PATH}">${parts.map((p, i) => (i % 2 === 1 ? html`<tspan class="wkp">${p}</tspan>` : p))}</tspan></text>`,
    });
  }
  const defs = html`<defs>${[...labels.values()].map((l) => l.svg)}</defs>`;
  const rowSvg = rows.map((req, i) => {
    const y = W_TOP + i * W_ROW;
    const ref = labels.get(req.key)?.ref ?? '';
    const title = `${req.key} · ${req.status} · start +${formatMs(req.offset)} · ${req.duration === null ? 'no duration' : formatMs(req.duration)}`;
    if (req.duration !== null && (longest === null || req.duration > (longest.duration ?? 0))) {
      longest = req;
    }
    let mark: SafeHtml;
    if (req.duration === null) {
      const at = x(req.offset);
      mark = html`<path d="M${at} ${y + 4}l6 6-6 6-6-6z"/><text class="d" x="${r(at + 10)}" y="${y + 14}">${req.status}</text>`;
    } else {
      const from = x(req.offset);
      const width = Math.max(2, r(req.duration * scale));
      const end = r(from + width);
      const ok = /^[23]/u.test(req.status);
      const text = `${formatMs(req.duration)}${ok ? '' : ` · ${req.status}`}`;
      // The time goes after the bar, or before it when the bar ends near the right edge.
      const label =
        end > W_RIGHT - 40
          ? html`<text class="d ae" x="${r(from - 6)}" y="${y + 14}">${text}</text>`
          : html`<text class="d" x="${r(end + 6)}" y="${y + 14}">${text}</text>`;
      mark = html`<rect x="${from}" y="${y + 4}" width="${width}" height="12" rx="2"/>${label}`;
    }
    return html`<g class="${waterfallClass(req.status)}"><title>${title}</title><use href="#${ref}" y="${y + 14}"/>${mark}</g>`;
  });
  const top = longest as Waterfall['requests'][number] | null;
  const summary = [
    `Waterfall of ${plural(waterfall.requestCount, 'request')} over ${formatMs(waterfall.spanMs)}`,
    top === null ? null : `longest request ${top.key} ${formatMs(top.duration ?? 0)}`,
  ]
    .filter((s) => s !== null)
    .join('; ');
  return html`<svg class="wf ch" viewBox="0 0 ${W_WIDTH} ${height}" role="img" aria-label="${summary}">${defs}${ticks}<path class="sep" d="M${W_SEP} 16V${height}"/>${rowSvg}</svg>`;
}
