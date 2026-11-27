// Output of a check (04-REQ-50): what would be measured and how long a full run would take.
// Errors, warnings and the verdict in frames like the run summary (09-REQ-27). Pure: the reporter
// collects the data.
import type { Issue } from '../core/types/index.ts';
import { marks } from './box.ts';
import { painter } from './color.ts';
import { issueBox, verdictBox } from './summary.ts';
import { padEnd, plural, truncateMiddle } from './text.ts';

export interface CheckProject {
  name: string;
  role: 'measured' | 'dependency' | 'teardown';
  browserName: string | null;
  /** Request calls only, no browser sample (04-REQ-50, 02-REQ-42). */
  requestOnly?: boolean;
  baseURL: string | null;
  requests: number;
  tests: number;
}

export interface CheckOrigin {
  origin: string;
  label: string;
  requests: number;
  /** baseURL, keys.origins, keys.origins pattern <pattern> or host. */
  source: string;
}

export interface CheckKey {
  kind: 'api' | 'step';
  key: string;
  samples: number;
  tests: number;
}

export interface CheckThresholdsFile {
  kind: 'api' | 'step';
  name: string;
  /** `N entries`, `missing`, `invalid (CODE)` or `not used`. */
  state: string;
}

export interface CheckSummary {
  packageName: string;
  ran: number;
  selected: number;
  passed: number;
  failed: number;
  skippedByCheck: number;
  projects: CheckProject[];
  reporters: { kept: string[]; replaced: string[]; removed: string[] };
  requests: number;
  apiKeys: number;
  stepKeys: number;
  origins: CheckOrigin[];
  topKeys: CheckKey[];
  thresholdsFiles: CheckThresholdsFile[];
  warnings: Issue[];
  toolErrors: Issue[];
  estimate: string;
  /** --shard=i/n of the check (17-REQ-09), or null. */
  shard?: { current: number; total: number } | null;
}

const MAX_WARNINGS = 10;
const CHECK_REASON = 'nothing was evaluated and no files were written';

/** The check output, ending with the badge line; the Next: line is printed by the caller. */
export function formatCheckSummary(
  s: CheckSummary,
  opts: { width: number; color: boolean; ascii?: boolean },
): string {
  const paint = painter(opts.color);
  const lines: string[] = [];
  lines.push('─'.repeat(Math.max(20, opts.width)));
  const failed = s.failed > 0 ? `, ${String(s.failed)} failed` : '';
  const shardText =
    s.shard === undefined || s.shard === null
      ? ''
      : ` · shard ${String(s.shard.current)}/${String(s.shard.total)}`;
  // 17-REQ-09: the last line says that only the tests of this shard were checked.
  const reason =
    shardText === '' ? CHECK_REASON : `${CHECK_REASON}; only the tests of this shard were checked`;
  lines.push(
    paint(
      `${s.packageName} · check${shardText} · ${String(s.ran)} of ${plural(s.selected, 'test')} run (${String(s.passed)} passed${failed}) · ${String(s.skippedByCheck)} skipped by check`,
      'bold',
    ),
    '',
  );

  lines.push(paint('Projects:', 'bold'));
  for (const p of s.projects) {
    if (p.role === 'measured') {
      const browser =
        p.requestOnly === true
          ? ' (no browser)'
          : p.browserName === null
            ? ''
            : ` (${p.browserName})`;
      lines.push(
        `  measured    ${p.name}${browser} · baseURL ${p.baseURL === null ? '(not set)' : p.baseURL.trim() === '' ? '(empty)' : p.baseURL} · ${plural(p.requests, 'request')} in ${plural(p.tests, 'test')}`,
      );
    } else {
      lines.push(`  dependency  ${p.name} · runs once, not measured`);
    }
  }

  const reporterParts = [
    `kept ${s.reporters.kept.length === 0 ? 'none' : s.reporters.kept.join(', ')}${s.reporters.replaced.length > 0 ? ` (${s.reporters.replaced.join(', ')} replaced)` : ''}`,
    ...(s.reporters.removed.length > 0 ? [`removed ${s.reporters.removed.join(', ')}`] : []),
  ];
  lines.push(`${paint('Reporters:', 'bold')}    ${reporterParts.join(' · ')}`);

  lines.push(
    `${paint('Requests:', 'bold')}     ${plural(s.requests, 'request')} · ${plural(s.apiKeys, 'api key')} · ${plural(s.stepKeys, 'step key')} · ${plural(s.origins.length, 'origin')}`,
  );
  const labelWidth = Math.max(6, ...s.origins.map((o) => (o.label === '' ? 6 : o.label.length)));
  const originWidth = Math.max(...s.origins.map((o) => o.origin.length), 0);
  for (const o of s.origins) {
    lines.push(
      `  ${padEnd(o.label === '' ? '(main)' : o.label, labelWidth)} ${padEnd(o.origin, originWidth)} ${String(o.requests).padStart(6)}  ${o.source}`,
    );
  }

  if (s.topKeys.length > 0) {
    lines.push(paint('Top keys:', 'bold'));
    const keyWidth = Math.max(30, opts.width - 40);
    s.topKeys.forEach((k, i) => {
      lines.push(
        `  ${String(i + 1).padStart(2)}. ${padEnd(k.kind, 4)} ${padEnd(truncateMiddle(k.key, keyWidth), Math.min(keyWidth, 50))} ${plural(k.samples, 'sample')} · ${plural(k.tests, 'test')}`,
      );
    });
  }

  lines.push(
    `${paint('Thresholds files:', 'bold')} ${s.thresholdsFiles.map((f) => `${f.kind} ${f.state === 'missing' ? `missing (${f.name})` : f.state === 'not used' ? 'not used' : `${f.state} (${f.name})`}`).join(' · ')}`,
  );

  const frame = { width: opts.width, color: opts.color, ascii: opts.ascii ?? false };
  if (s.toolErrors.length > 0 || s.warnings.length > 0) lines.push('');
  lines.push(...issueBox('error', s.toolErrors, Infinity, frame));
  lines.push(...issueBox('warning', s.warnings, MAX_WARNINGS, frame));
  if (lines[lines.length - 1] === '') lines.pop();

  lines.push('', `${paint('Estimate:', 'bold')} ${s.estimate}`, '');
  const m = marks(frame.ascii);
  lines.push(
    ...(s.toolErrors.length === 0
      ? verdictBox(m.ok, 'CHECKED', reason, 'green', 'badge-green', frame)
      : verdictBox(m.error, 'ERROR', reason, 'magenta', 'badge-magenta', frame)),
  );
  return `${lines.join('\n')}\n`;
}
