// Output of a check (04-REQ-50): what would be measured and how long a full run would take.
// Pure: the reporter collects the data.
import type { Issue } from '../core/types/index.ts';
import { painter } from './color.ts';
import { padEnd, truncateMiddle } from './text.ts';

export interface CheckProject {
  name: string;
  role: 'measured' | 'dependency' | 'teardown';
  browserName: string | null;
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
  removedProjects: string[];
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
}

const MAX_WARNINGS = 10;

/** The check output, ending with the badge line; the Next: line is printed by the caller. */
export function formatCheckSummary(
  s: CheckSummary,
  opts: { width: number; color: boolean },
): string {
  const paint = painter(opts.color);
  const lines: string[] = [];
  lines.push('─'.repeat(Math.max(20, opts.width)));
  const failed = s.failed > 0 ? `, ${String(s.failed)} failed` : '';
  lines.push(
    paint(
      `${s.packageName} · check · ${String(s.ran)} of ${String(s.selected)} tests run (${String(s.passed)} passed${failed}) · ${String(s.skippedByCheck)} skipped by check`,
      'bold',
    ),
    '',
  );

  lines.push(paint('Projects:', 'bold'));
  for (const p of s.projects) {
    if (p.role === 'measured') {
      const browser = p.browserName === null ? '' : ` (${p.browserName})`;
      lines.push(
        `  measured    ${p.name}${browser} · baseURL ${p.baseURL ?? '(not set)'} · ${String(p.requests)} requests in ${String(p.tests)} tests`,
      );
    } else {
      lines.push(`  dependency  ${p.name} · runs once, not measured`);
    }
  }
  if (s.removedProjects.length > 0) {
    lines.push(`  not run     ${s.removedProjects.join(', ')} (not in run.projects)`);
  }

  const reporterParts = [
    `kept ${s.reporters.kept.length === 0 ? 'none' : s.reporters.kept.join(', ')}${s.reporters.replaced.length > 0 ? ` (${s.reporters.replaced.join(', ')} replaced)` : ''}`,
    ...(s.reporters.removed.length > 0 ? [`removed ${s.reporters.removed.join(', ')}`] : []),
  ];
  lines.push(`${paint('Reporters:', 'bold')}    ${reporterParts.join(' · ')}`);

  lines.push(
    `${paint('Requests:', 'bold')}     ${String(s.requests)} requests · ${String(s.apiKeys)} api keys · ${String(s.stepKeys)} step keys · ${String(s.origins.length)} ${s.origins.length === 1 ? 'origin' : 'origins'}`,
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
        `  ${String(i + 1).padStart(2)}. ${padEnd(k.kind, 4)} ${padEnd(truncateMiddle(k.key, keyWidth), Math.min(keyWidth, 50))} ${String(k.samples)} samples · ${String(k.tests)} tests`,
      );
    });
  }

  lines.push(
    `${paint('Thresholds files:', 'bold')} ${s.thresholdsFiles.map((f) => `${f.kind} ${f.state === 'missing' ? `missing (${f.name})` : f.state === 'not used' ? 'not used' : `${f.state} (${f.name})`}`).join(' · ')}`,
  );

  if (s.toolErrors.length > 0) {
    lines.push('', paint('Errors:', 'bold'));
    for (const e of s.toolErrors) {
      lines.push(`  ${paint(`✖ ${e.code}`, 'red')}: ${e.message}`);
      if (e.hint !== undefined) lines.push(paint(`    Hint: ${e.hint}`, 'dim'));
    }
  }
  if (s.warnings.length > 0) {
    lines.push('', paint('Warnings:', 'bold'));
    for (const w of s.warnings.slice(0, MAX_WARNINGS)) {
      lines.push(`  ${paint(`! ${w.code}`, 'yellow')}: ${w.message}`);
      if (w.hint !== undefined) lines.push(paint(`    Hint: ${w.hint}`, 'dim'));
    }
    if (s.warnings.length > MAX_WARNINGS) {
      lines.push(`  … and ${String(s.warnings.length - MAX_WARNINGS)} more`);
    }
  }

  lines.push('', `${paint('Estimate:', 'bold')} ${s.estimate}`, '');
  const badge =
    s.toolErrors.length === 0
      ? paint(' ✔ CHECKED ', 'badge-green')
      : paint(' ✖ ERROR ', 'badge-magenta');
  lines.push(`${badge} nothing was evaluated and no files were written`);
  return `${lines.join('\n')}\n`;
}
