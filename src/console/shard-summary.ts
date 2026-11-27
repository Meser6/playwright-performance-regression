// Console output of a shard (17-REQ-08) and the Outcome lines of a shard and of the merge
// (17-REQ-08, 17-REQ-19). Pure.
import type { Issue, Outcome } from '../core/types/index.ts';
import { table } from './box.ts';
import { performanceText } from './outcome-line.ts';
import { issueBox } from './summary.ts';
import { plural } from './text.ts';

export interface ShardSummaryInput {
  packageName: string;
  shard: { current: number; total: number };
  /** Measured tests of the shard in one pass. */
  tests: number;
  passes: number;
  samples: { api: number; step: number };
  /** Path of the shard file as shown. */
  data: string;
  /** Warnings of the shard, shown only after the merge. */
  warnings: number;
  toolErrors: readonly Issue[];
}

function count(n: number): string {
  return n.toLocaleString('en-US');
}

/** The tool errors box (if any) and the shard box; every line ends with a newline. */
export function formatShardSummary(
  input: ShardSummaryInput,
  opts: { width: number; color: boolean; ascii: boolean },
): string {
  const { current, total } = input.shard;
  const runs = input.tests * input.passes;
  const all = input.samples.api + input.samples.step;
  const rows: [string, string][] = [
    [
      'Tests',
      `${plural(input.tests, 'test')} × ${plural(input.passes, 'pass', 'passes')} = ${plural(runs, 'test run')}`,
    ],
    [
      'Samples',
      `${count(all)} (api ${count(input.samples.api)} · step ${count(input.samples.step)})`,
    ],
    ['Data', input.data],
  ];
  if (input.warnings > 0)
    rows.push(['Warnings', `${String(input.warnings)} (shown after the merge)`]);
  const icon = opts.ascii ? '' : '⏳ ';
  const lines = [
    ...issueBox('error', input.toolErrors, Infinity, opts),
    ...table(
      [
        { header: '', style: 'bold' },
        { header: '', flex: true, minWidth: 10 },
      ],
      rows.map((cells) => ({ cells })),
      {
        ...opts,
        border: 'cyan',
        header: false,
        title: `${icon}${input.packageName} · shard ${String(current)}/${String(total)} done`,
      },
    ),
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * `Outcome: Playwright exit code 0 · details: shard data written (code 0) in <path>` (17-REQ-08):
 * a shard never evaluates, so the details tell whether its data are complete.
 */
export function shardOutcomeLine(outcome: Outcome, path: string): string {
  const playwright = outcome.tests.status === 'passed' && outcome.exitCode === 0 ? 0 : 1;
  const details = outcome.exitCode === 0 ? 'shard data written' : 'shard data incomplete';
  return `Outcome: Playwright exit code ${String(playwright)} · details: ${details} (code ${String(outcome.exitCode)}) in ${path}\n`;
}

/**
 * `Outcome: performance failed (code 2) in <path>` (17-REQ-19): the merge ends with its own exit
 * code, so there is no Playwright part.
 */
export function mergeOutcomeLine(outcome: Outcome, path: string): string {
  return `Outcome: ${performanceText(outcome)} (code ${String(outcome.exitCode)}) in ${path}\n`;
}
