// Console output of the thresholds diff (10, chapter 9.1). Pure: the caller passes the display
// paths, the terminal width and the color decision, and prints the text.
import {
  LISTED_CATEGORIES,
  diffChangeText,
  diffCountsText,
  diffMarker,
} from '../core/types/index.ts';
import type { KeyDiff, ThresholdsDiff } from '../core/types/index.ts';
import { padEnd, plural, textWidth, truncateMiddle } from './text.ts';

export interface ThresholdsDiffOptions {
  /** Path of each thresholds file as shown, parallel to the diffs. */
  paths: string[];
  /** Terminal columns; 120 without a terminal (09-REQ-22). */
  width: number;
  /** ANSI colors: only in a TTY without NO_COLOR (09-REQ-22). */
  color: boolean;
  /** --prune was given: unseen entries left in the file are locked ones. */
  prune: boolean;
  /** Path of thresholds-diff.md as shown, or null when it was not written. */
  diffPath: string | null;
}

/** At most this many change rows per file; the rest is in thresholds-diff.md (10, chapter 9.1). */
export const MAX_DIFF_ROWS = 30;
/** Minimum width of the key column (09-REQ-22). */
export const MIN_KEY_WIDTH = 30;

const ANSI = { red: '\u001b[31m', yellow: '\u001b[33m', green: '\u001b[32m' };
const RESET = '\u001b[0m';
type Style = keyof typeof ANSI;

const MARKER_STYLE: Record<string, Style> = {
  '+': 'green',
  '-': 'red',
  '↑': 'yellow',
  '↓': 'green',
  '±': 'yellow',
};

function fileLines(
  diff: ThresholdsDiff,
  path: string,
  opts: ThresholdsDiffOptions,
  paint: (text: string, style: Style) => string,
): string[] {
  const lines = [`Thresholds: ${path} (${fileStatusText(diff)})`];
  const listed = diff.keys.filter((k) => LISTED_CATEGORIES.has(k.category));
  const expired = diff.keys.filter((k) => k.muted?.expired === true);
  if (diff.fileStatus !== 'unchanged') lines.push(`  ${diffCountsText(diff)}`);

  if (listed.length > 0) {
    const shown = listed.slice(0, MAX_DIFF_ROWS);
    const rows = shown.map((k) => ({
      marker: diffMarker(k),
      key: k.key,
      change: diffChangeText(k, diff.level, '  ') + mutedSuffix(k),
    }));
    const markerWidth = Math.max(...rows.map((r) => textWidth(r.marker)));
    const changeWidth = Math.max(...rows.map((r) => textWidth(r.change)));
    const longest = Math.max(...rows.map((r) => textWidth(r.key)));
    // "  " + marker + " " + key + "  " + change.
    const rest = opts.width - 2 - markerWidth - 1 - 2 - changeWidth;
    const keyWidth = Math.max(MIN_KEY_WIDTH, Math.min(longest, rest));
    lines.push('');
    for (const r of rows) {
      const head = r.marker.slice(0, 1);
      const style = MARKER_STYLE[head] ?? 'yellow';
      const marker =
        paint(head, style) + (r.marker.length > 1 ? paint(r.marker.slice(1), 'red') : '');
      const pad = ' '.repeat(markerWidth - textWidth(r.marker));
      lines.push(
        `  ${marker}${pad} ${padEnd(truncateMiddle(r.key, keyWidth), keyWidth)}  ${r.change}`.trimEnd(),
      );
    }
    if (listed.length > shown.length) {
      lines.push(`  … and ${listed.length - shown.length} more`);
    }
  }
  if (expired.length > 0) {
    lines.push('');
    for (const k of expired) {
      lines.push(`  ${paint('!', 'yellow')} ${k.key} muted (expired ${k.muted?.until ?? ''})`);
    }
  }
  const unseen = diff.counts.unseen;
  if (unseen > 0) {
    const entries = plural(unseen, 'entry', 'entries');
    const verb = unseen === 1 ? 'was' : 'were';
    lines.push(
      '',
      opts.prune
        ? `  ${entries} not seen in this run ${verb} kept because ${unseen === 1 ? 'it is' : 'they are'} locked.`
        : `  ${entries} ${verb} not seen in this run and ${verb} kept. Use --prune to remove them.`,
    );
  }
  return lines;
}

/** File status as shown: "not-written" reads "not written". */
export function fileStatusText(diff: ThresholdsDiff): string {
  return diff.fileStatus === 'not-written' ? 'not written' : diff.fileStatus;
}

function mutedSuffix(k: KeyDiff): string {
  return k.muted !== undefined && !k.muted.expired ? `  (muted until ${k.muted.until})` : '';
}

/**
 * Console text of the thresholds diff (10, chapter 9.1): per file the status, the category
 * counters and the changes (added, removed, loosened, tightened, mixed) with the values before
 * and after, at most MAX_DIFF_ROWS rows; expired mutings on their own line (10-REQ-21).
 * Ends with a newline.
 */
export function formatThresholdsDiff(diffs: ThresholdsDiff[], opts: ThresholdsDiffOptions): string {
  const paint = (text: string, style: Style): string =>
    opts.color ? `${ANSI[style]}${text}${RESET}` : text;
  const lines: string[] = [];
  diffs.forEach((diff, i) => {
    lines.push(...fileLines(diff, opts.paths[i] ?? `${diff.kind} thresholds`, opts, paint));
  });
  const written = diffs.some((d) => d.fileStatus === 'created' || d.fileStatus === 'updated');
  lines.push('');
  lines.push(
    written
      ? 'Review the changes and commit the thresholds files.'
      : 'The thresholds files are up to date.',
  );
  if (opts.diffPath !== null) lines.push(`Diff: ${opts.diffPath}`);
  return `${lines.join('\n')}\n`;
}
