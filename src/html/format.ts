// Number and date formatting of the HTML report (11-REQ-19): fixed, locale-independent and
// without the time zone of the machine (11-REQ-02, 11-D-08).

/** Durations: below 10 ms one decimal, from 10 000 ms seconds with one decimal, else whole ms. */
export function formatMs(value: number): string {
  if (value >= 10_000) return `${(Math.round(value / 100) / 10).toFixed(1)} s`;
  if (value < 10) return `${(Math.round(value * 10) / 10).toFixed(1)} ms`;
  return `${Math.round(value)} ms`;
}

/** Shares (Apdex, Wilson bounds) with three decimals. */
export function formatRatio(value: number): string {
  return value.toFixed(3);
}

/** A share as a percentage with one decimal, e.g. 0.004 → `0.4%` (error rates, hint shares). */
export function formatPercent(share: number): string {
  return `${(Math.round(share * 1000) / 10).toFixed(1)}%`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DD HH:mm:ss UTC`; text that is not a date is returned unchanged. */
export function formatDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  const d = new Date(time);
  return (
    `${String(d.getUTCFullYear())}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
  );
}

/** Wall-clock duration of the run: `1 h 02 min`, `12 min 03 s` or `45 s`; `—` when unknown. */
export function formatRunDuration(startedAt: string, finishedAt: string): string {
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const min = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${String(h)} h ${pad(min)} min`;
  if (min > 0) return `${String(min)} min ${pad(s)} s`;
  return `${String(s)} s`;
}

/** `n word` with a plural `s` (or the given plural form). */
export function plural(n: number, word: string, many = `${word}s`): string {
  return `${String(n)} ${n === 1 ? word : many}`;
}

/** Shortens text in the middle to at most `max` code points, with `…` (11, chapter 6.4). */
export function truncateMiddle(text: string, max: number): string {
  const points = Array.from(text);
  if (points.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return `${points.slice(0, head).join('')}…${points.slice(points.length - (keep - head)).join('')}`;
}

/** usage · 10⁴ as an integer: usage has 4 decimals, so percentages need no float rounding. */
function basisPoints(usage: number): number {
  return Math.round(usage * 1e4);
}

/** Whole percent of the limit, rounded down: 0.8799 → 87 (11-REQ-30). */
export function usagePercent(usage: number): number {
  return Math.floor(basisPoints(usage) / 100);
}

/** Percent over the limit, rounded up and at least 1: 1.35 → 35, 1.00001 → 1 (11-REQ-30). */
export function overPercent(usage: number): number {
  return Math.max(1, Math.ceil((basisPoints(usage) - 10_000) / 100));
}

/**
 * Headroom of a check or key (11-REQ-30): `87%` within the limit, `+35% over` for a failed check,
 * `over (limit 0)` for null and `>999%` from 1000%. A failed check at a rounded usage of 1 is
 * `+1% over`. `long` adds "of limit" to the first form.
 */
export function usageText(usage: number | null, failed: boolean, long = false): string {
  if (usage === null) return 'over (limit 0)';
  const suffix = long ? ' of limit' : '';
  if (basisPoints(usage) >= 100_000) return `>999%${suffix}`;
  if (failed) return `+${String(overPercent(usage))}% over`;
  return `${String(usagePercent(usage))}%${suffix}`;
}
