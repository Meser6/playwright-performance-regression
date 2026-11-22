// thresholds-diff.md: the diff of every thresholds file for a PR description or a CI artifact
// (10-REQ-19).
import {
  LISTED_CATEGORIES,
  diffCountsText,
  diffMarker,
  diffValuesText,
  skippedReasonText,
} from '../types/index.ts';
import type { ThresholdsDiff } from './types.ts';

/** Table cell text: "|" and line breaks would break the table. */
function cell(text: string): string {
  return text.replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ');
}

/** A key as inline code; a key with a backtick is written as plain escaped text. */
function code(key: string): string {
  return key.includes('`') ? cell(key) : `\`${cell(key)}\``;
}

/**
 * 10-REQ-19: Markdown for thresholds-diff.md; pure. One section per thresholds file (`paths[i]`
 * is the path of `diffs[i]`): status, category counters, a table of every change with the values
 * before and after (no row limit), and a line for every expired muting (10-REQ-21).
 */
export function formatThresholdsDiffMarkdown(diffs: ThresholdsDiff[], paths: string[]): string {
  const lines: string[] = ['# Thresholds diff'];
  diffs.forEach((diff, i) => {
    const path = paths[i] ?? `${diff.kind} thresholds`;
    lines.push(
      '',
      `## ${cell(path)} (${diff.fileStatus === 'not-written' ? 'not written' : diff.fileStatus})`,
      '',
      diffCountsText(diff),
    );
    const listed = diff.keys.filter((k) => LISTED_CATEGORIES.has(k.category));
    if (listed.length > 0) {
      lines.push('', '| | Key | Before | After |', '|---|---|---|---|');
      for (const k of listed) {
        const before = diffValuesText(k, 'before', diff.level, ' · ');
        const after = diffValuesText(k, 'after', diff.level, ' · ');
        lines.push(`| ${diffMarker(k)} | ${code(k.key)} | ${cell(before)} | ${cell(after)} |`);
      }
    }
    // Every skipped key with its reason, no limit (10-REQ-19, 10-D-21).
    const skipped = diff.keys.filter((k) => k.category === 'skipped' && k.samples !== undefined);
    if (skipped.length > 0) {
      lines.push('', 'Skipped (no entry derived):', '');
      for (const k of skipped) {
        if (k.samples !== undefined)
          lines.push(`- ${code(k.key)}: ${skippedReasonText(k.samples)}`);
      }
    }
    const expired = diff.keys.filter((k) => k.muted?.expired === true);
    if (expired.length > 0) {
      lines.push('');
      for (const k of expired) {
        lines.push(`- ${code(k.key)} muted (expired ${k.muted?.until ?? ''})`);
      }
    }
    const large = listed.filter((k) => k.changes.some((c) => c.large === true)).length;
    if (large > 0) {
      lines.push(
        '',
        `Entries marked with ! loosened a time limit by a large step; check that they do not accept a regression.`,
      );
    }
  });
  return `${lines.join('\n')}\n`;
}
