// The start banner of a perf-mode run (04-REQ-65, uwaga #36): mode, projects, tests × passes,
// estimate, report path and a tip. Pure.
import { box } from './box.ts';
import type { BoxLine } from './box.ts';
import { plural } from './text.ts';

export interface StartBannerInput {
  packageName: string;
  mode: 'test' | 'thresholds' | 'check';
  measured: readonly string[];
  /** Dependency and teardown projects, run once per pass. */
  dependencies: readonly string[];
  /** Tests of measured projects in one pass. */
  tests: number;
  passes: number;
  /** Check: PW_PERF_MAX_TESTS. */
  maxTests?: number;
  /** Estimate value; null leaves the row out (check). */
  estimate: string | null;
  /** Path of the report, or null when nothing is written (check). */
  report: string | null;
  /** The arguments select no subset of the tests. */
  tip: boolean;
}

const TITLES: Record<StartBannerInput['mode'], string> = {
  test: 'measurement run',
  thresholds: 'thresholds run',
  check: 'check (dry run)',
};

function names(list: readonly string[]): string {
  return list.map((n) => (n === '' ? '(default)' : n)).join(', ');
}

const LABEL = 10;

/** The banner; every line ends with a newline. */
export function formatStartBanner(
  input: StartBannerInput,
  opts: { width: number; color: boolean; ascii: boolean },
): string {
  const row = (label: string, value: string): BoxLine => ({
    text: `${label.padEnd(LABEL)}${value}`,
  });
  const icon = opts.ascii ? '' : '⏱️  ';
  const lines: BoxLine[] = [
    { text: `${icon}${input.packageName} · ${TITLES[input.mode]}`, style: 'bold' },
  ];
  const deps = input.dependencies.length > 0 ? ` (setup: ${names(input.dependencies)})` : '';
  lines.push(row('Projects', `${names(input.measured)}${deps}`));
  if (input.mode === 'check') {
    lines.push(
      row(
        'Tests',
        `${plural(input.tests, 'test')}; the first test of each file runs once, at most ${String(input.maxTests ?? input.tests)}`,
      ),
    );
  } else {
    lines.push(
      row(
        'Tests',
        `${plural(input.tests, 'test')} × ${plural(input.passes, 'pass', 'passes')} = ${plural(input.tests * input.passes, 'test run')}`,
      ),
    );
  }
  if (input.estimate !== null) lines.push(row('Estimate', input.estimate));
  lines.push(row('Report', input.report ?? 'no files are written'));
  if (input.tip) lines.push(row('Tip', 'measure a subset, e.g. --grep @perf'));
  return box(lines, { ...opts, border: 'cyan' });
}
