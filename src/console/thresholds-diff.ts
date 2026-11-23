// Console output of the thresholds diff (10, chapter 9.1). Pure: the caller passes the display
// paths, the terminal width and the color decision, and prints the text.
import {
  LISTED_CATEGORIES,
  diffChangeText,
  diffCountsText,
  diffMarker,
  skippedReasonText,
} from '../core/types/index.ts';
import type { KeyDiff, ThresholdsDiff } from '../core/types/index.ts';
import { table } from './box.ts';
import { painter } from './color.ts';
import type { ColorStyle } from './color.ts';
import { plural } from './text.ts';

export interface ThresholdsDiffOptions {
  /** Path of each thresholds file as shown, parallel to the diffs. */
  paths: string[];
  /** Terminal columns; 120 without a terminal (09-REQ-22). */
  width: number;
  /** ANSI colors: see colorEnabled (09-REQ-22, 04-REQ-44). */
  color: boolean;
  /** Pruning was on (PW_PERF_PRUNE=1): unseen entries left in the file are locked ones. */
  prune: boolean;
  /** Absolute path of thresholds-diff.md (10, chapter 9.1), or null when it was not written. */
  diffPath: string | null;
  /**
   * The files are in the temporary folder of the wizard's check (PW_PERF_THRESHOLDS_DIR,
   * 04-REQ-58): nothing to commit (10, chapter 9.1).
   */
  temporary?: boolean;
  /**
   * The run selects a subset of the tests in the Playwright arguments (04-REQ-35): PW_PERF_PRUNE
   * would be ignored, so the unseen line does not advise it (10, chapter 9.1).
   */
  subset?: boolean;
  /** TERM=dumb: tables with `+`, `-`, `|` (09-REQ-27); false by default. */
  ascii?: boolean;
}

/** At most this many change rows per file; the rest is in thresholds-diff.md (10, chapter 9.1). */
export const MAX_DIFF_ROWS = 30;
/** Minimum width of the key column (09-REQ-22). */
export const MIN_KEY_WIDTH = 30;
/** At most this many skipped keys per file; all are in thresholds-diff.md (10-D-21). */
export const MAX_SKIPPED_ROWS = 5;

type Style = Extract<ColorStyle, 'red' | 'yellow' | 'green'>;

const MARKER_STYLE: Record<string, Style> = {
  '+': 'green',
  '-': 'red',
  '↑': 'yellow',
  '↓': 'green',
  '±': 'yellow',
};

/** Color of a change marker; a large change ("↑!") is red (10, chapter 9.1). */
function markerStyle(marker: string): Style {
  if (marker.length > 1) return 'red';
  return MARKER_STYLE[marker] ?? 'yellow';
}

function fileLines(
  diff: ThresholdsDiff,
  path: string,
  opts: ThresholdsDiffOptions,
  paint: (text: string, style: ColorStyle) => string,
): string[] {
  const lines = [`Thresholds: ${path} (${fileStatusText(diff)})`];
  const listed = diff.keys.filter((k) => LISTED_CATEGORIES.has(k.category));
  const expired = diff.keys.filter((k) => k.muted?.expired === true);
  if (diff.fileStatus !== 'unchanged') lines.push(`  ${diffCountsText(diff)}`);
  const tableOpts = { width: opts.width, color: opts.color, ascii: opts.ascii === true };

  // Changes in a table (09-REQ-27, 09-D-24): marker, key, values before and after.
  const shown = listed.slice(0, MAX_DIFF_ROWS);
  if (shown.length > 0) {
    lines.push('');
    lines.push(
      ...table(
        [
          { header: '' },
          { header: 'key', flex: true, minWidth: MIN_KEY_WIDTH },
          { header: 'change' },
        ],
        shown.map((k) => {
          const marker = diffMarker(k);
          return {
            cells: [marker, k.key, diffChangeText(k, diff.level, '  ') + mutedSuffix(k)],
            cellStyles: [markerStyle(marker)],
          };
        }),
        tableOpts,
      ),
    );
    if (listed.length > shown.length) {
      lines.push(paint(`  … and ${String(listed.length - shown.length)} more`, 'dim'));
    }
  }
  // Skipped keys with their reason (10, chapter 9.1, 10-D-21).
  const skipped = diff.keys.filter((k) => k.category === 'skipped' && k.samples !== undefined);
  const skippedShown = skipped.slice(0, MAX_SKIPPED_ROWS);
  if (skippedShown.length > 0) {
    lines.push('');
    lines.push(
      ...table(
        [{ header: 'skipped', flex: true, minWidth: MIN_KEY_WIDTH }, { header: 'reason' }],
        skippedShown.map((k) => ({
          cells: [k.key, k.samples === undefined ? '' : skippedReasonText(k.samples)],
        })),
        tableOpts,
      ),
    );
    if (skipped.length > skippedShown.length) {
      const more = `  … and ${String(skipped.length - skippedShown.length)} more skipped`;
      lines.push(paint(opts.diffPath === null ? more : `${more} (see thresholds-diff.md)`, 'dim'));
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
        : opts.subset === true
          ? `  ${entries} ${verb} not seen in this run (it selects a subset of the tests) and ${verb} kept.`
          : `  ${entries} ${verb} not seen in this run and ${verb} kept. Run with PW_PERF_PRUNE=1 to remove them.`,
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
  const paint = painter(opts.color);
  const lines: string[] = [];
  diffs.forEach((diff, i) => {
    lines.push(...fileLines(diff, opts.paths[i] ?? `${diff.kind} thresholds`, opts, paint));
  });
  const written = diffs.some((d) => d.fileStatus === 'created' || d.fileStatus === 'updated');
  lines.push('');
  lines.push(
    opts.temporary === true
      ? 'These thresholds are temporary (the setup check deletes them); there is nothing to commit.'
      : written
        ? 'Review the changes and commit the thresholds files.'
        : 'The thresholds files are up to date.',
  );
  if (opts.diffPath !== null) lines.push(`Diff: ${opts.diffPath}`);
  return `${lines.join('\n')}\n`;
}
