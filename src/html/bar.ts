// Static SVG percentile bar of one key (11-REQ-11, 11-D-03): an axis from 0 to the larger of max
// and the p99 limit, markers for p50, p90, p95, p99 and max, and the limit lines. Every mark has a
// text label; there is no histogram, because the page holds no raw samples.
import type { KeyEvaluation, Stats } from '../core/types/index.ts';
import { html } from './escape.ts';
import type { SafeHtml } from './escape.ts';
import { formatMs } from './format.ts';

const WIDTH = 640;
const LEFT = 24;
const RIGHT = 616;
/** Height of one label row and the estimated width of one character at the label font size. */
const ROW = 13;
const CHAR = 6.2;
const GAP = 8;

interface Mark {
  label: string;
  value: number;
}

interface Placed {
  text: string;
  x: number;
  row: number;
  anchor: 'start' | 'middle' | 'end';
}

function coordinate(value: number, axisMax: number): number {
  return Math.round((LEFT + ((RIGHT - LEFT) * value) / axisMax) * 10) / 10;
}

/** Marks with the same value share one label, e.g. `p95, p99 50 ms`. */
function merge(marks: readonly Mark[]): Mark[] {
  const out: Mark[] = [];
  for (const mark of marks) {
    const same = out.find((m) => m.value === mark.value);
    if (same === undefined) out.push({ ...mark });
    else same.label = `${same.label}, ${mark.label}`;
  }
  return out;
}

/** Puts each label on the first row where it does not overlap the labels already there. */
function place(marks: readonly Mark[], axisMax: number): Placed[] {
  const rowsEnd: number[] = [];
  return [...marks]
    .sort((a, b) => a.value - b.value)
    .map((mark) => {
      const x = coordinate(mark.value, axisMax);
      const text = `${mark.label} ${formatMs(mark.value)}`;
      const width = text.length * CHAR;
      const anchor = x - width / 2 < 0 ? 'start' : x + width / 2 > WIDTH ? 'end' : 'middle';
      const from = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
      let row = rowsEnd.findIndex((end) => end + GAP <= from);
      if (row === -1) row = rowsEnd.length;
      rowsEnd[row] = from + width;
      return { text, x, row, anchor };
    });
}

/** The SVG of one key; null when the key has no successful samples. */
export function percentileBar(
  stats: Stats | null,
  limits: KeyEvaluation['limits'],
  level: string,
): SafeHtml | null {
  if (stats === null) return null;
  const p = stats.percentiles;
  const markers: Mark[] = [];
  for (const name of ['p50', 'p90', 'p95', 'p99']) {
    const value = p[name];
    if (value !== undefined) markers.push({ label: name, value });
  }
  markers.push({ label: 'max', value: stats.max });
  const lines: Mark[] = [];
  if (limits.t !== null) lines.push({ label: 'T', value: limits.t });
  lines.push({ label: 'median limit', value: limits.median });
  lines.push({ label: `${level} limit`, value: limits.percentile });
  lines.push({ label: 'p99 limit', value: limits.p99 });
  const axisMax = Math.max(stats.max, limits.p99) > 0 ? Math.max(stats.max, limits.p99) : 1;

  const top = place(merge(markers), axisMax);
  const bottom = place(merge(lines), axisMax);
  const topRows = Math.max(1, ...top.map((m) => m.row + 1));
  const bottomRows = Math.max(1, ...bottom.map((m) => m.row + 1));
  const axisY = 12 + ROW * topRows;
  const height = axisY + 22 + ROW * bottomRows + 14;

  const markerSvg = top.map((m) => {
    const y = axisY - 12 - ROW * m.row;
    return html`<line class="bar-mark" x1="${m.x}" y1="${axisY - 8}" x2="${m.x}" y2="${axisY + 8}"/><text x="${m.x}" y="${y}" text-anchor="${m.anchor}">${m.text}</text>`;
  });
  const lineSvg = bottom.map((m) => {
    const y = axisY + 24 + ROW * m.row;
    return html`<line class="bar-limit" x1="${m.x}" y1="${axisY - 4}" x2="${m.x}" y2="${y - 10}"/><text class="bar-limit-text" x="${m.x}" y="${y}" text-anchor="${m.anchor}">${m.text}</text>`;
  });
  const p50 = p['p50'];
  const p99 = p['p99'];
  let range: SafeHtml | null = null;
  if (p50 !== undefined && p99 !== undefined) {
    const x1 = coordinate(p50, axisMax);
    const width = Math.max(0, Math.round((coordinate(p99, axisMax) - x1) * 10) / 10);
    range = html`<rect class="bar-range" x="${x1}" y="${axisY - 4}" width="${width}" height="8"/>`;
  }
  const describe = [...markers, ...lines].map((m) => `${m.label} ${formatMs(m.value)}`).join(', ');
  const label = `Percentiles and limits: ${describe}`;
  return html`<svg class="bar" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${label}"><line class="bar-axis" x1="${LEFT}" y1="${axisY}" x2="${RIGHT}" y2="${axisY}"/>${range}${lineSvg}${markerSvg}<text class="bar-scale" x="${LEFT}" y="${height - 2}">0</text><text class="bar-scale" x="${RIGHT}" y="${height - 2}" text-anchor="end">${formatMs(axisMax)}</text></svg>`;
}
