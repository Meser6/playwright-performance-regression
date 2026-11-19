// Number and date formatting of the HTML report (11-REQ-19): fixed, locale-independent and
// without the time zone of the machine (11-REQ-02, 11-D-08).

/** Durations: below 10 ms one decimal, from 10 000 ms seconds with one decimal, else whole ms. */
export function formatMs(value: number): string {
  if (value >= 10_000) return `${(Math.round(value / 100) / 10).toFixed(1)} s`;
  if (value < 10) return `${(Math.round(value * 10) / 10).toFixed(1)} ms`;
  return `${Math.round(value)} ms`;
}

/** Shares (Apdex, Wilson bounds, error rates) with three decimals. */
export function formatRatio(value: number): string {
  return value.toFixed(3);
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

/** Wall-clock duration of the run, e.g. `1 h 2 min 3 s`, `5 min 0 s`, `42 s`. */
export function formatRunDuration(startedAt: string, finishedAt: string): string {
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const min = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${String(h)} h ${String(min)} min ${String(s)} s`;
  if (min > 0) return `${String(min)} min ${String(s)} s`;
  return `${String(s)} s`;
}

/** `n word` with a plural `s` (or the given plural form). */
export function plural(n: number, word: string, many = `${word}s`): string {
  return `${String(n)} ${n === 1 ? word : many}`;
}

/** Shortens text in the middle to at most `max` code points, with `…` (11, chapter 6.1). */
export function truncateMiddle(text: string, max: number): string {
  const points = Array.from(text);
  if (points.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return `${points.slice(0, head).join('')}…${points.slice(points.length - (keep - head)).join('')}`;
}
