// The start banner of a perf-mode run (04-REQ-65, uwaga #36): mode, projects, tests × passes,
// estimate, report path and a tip, as a table without a header row and with the title in its top
// edge (09-REQ-27, 09-D-24). Pure.
import { table } from './box.ts';
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

/** The banner; every line ends with a newline. */
export function formatStartBanner(
  input: StartBannerInput,
  opts: { width: number; color: boolean; ascii: boolean },
): string {
  const rows: [string, string][] = [];
  const deps = input.dependencies.length > 0 ? ` (setup: ${names(input.dependencies)})` : '';
  rows.push(['Projects', `${names(input.measured)}${deps}`]);
  if (input.mode === 'check') {
    rows.push([
      'Tests',
      `${plural(input.tests, 'test')}; the first test of each file runs once, at most ${String(input.maxTests ?? input.tests)}`,
    ]);
  } else {
    rows.push([
      'Tests',
      `${plural(input.tests, 'test')} × ${plural(input.passes, 'pass', 'passes')} = ${plural(input.tests * input.passes, 'test run')}`,
    ]);
  }
  if (input.estimate !== null) rows.push(['Estimate', input.estimate]);
  rows.push(['Report', input.report ?? 'no files are written']);
  if (input.tip) rows.push(['Tip', 'measure a subset, e.g. --grep @perf']);
  // ⏳ has Emoji_Presentation=Yes: two columns in every terminal, unlike ⏱️ (09-D-23).
  const icon = opts.ascii ? '' : '⏳ ';
  const lines = table(
    [
      { header: '', style: 'bold' },
      { header: '', flex: true, minWidth: 10 },
    ],
    rows.map((cells) => ({ cells })),
    {
      ...opts,
      border: 'cyan',
      header: false,
      title: `${icon}${input.packageName} · ${TITLES[input.mode]}`,
    },
  );
  return `${lines.join('\n')}\n`;
}
