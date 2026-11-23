// The IMPORTANT box that ends the wizard after a write (04-REQ-59, 04-D-56): the way from the
// written setup to a measurement run that fails on a regression, with the exact commands of
// 04-REQ-55. Pure.
import { box, marks } from '../../console/box.ts';
import type { BoxLine } from '../../console/box.ts';
import type { RunCommands } from './commands.ts';
import type { Translate } from './messages.ts';

/** The box is at most this wide (04-REQ-59). */
export const IMPORTANT_BOX_MAX_WIDTH = 80;
const MIN_WIDTH = 40;
/** Continuation lines of a numbered point start under its text ("1. "). */
const INDENT = 3;

export interface ImportantBoxInput {
  t: Translate;
  commands: RunCommands;
  /** Thresholds files to commit (04-REQ-47). */
  files: readonly string[];
  /** report.dir, relative to the playwright.config directory. */
  reportDir: string;
  /** The red box of 04-REQ-67 is shown: the perf fixture comes first. */
  fixFirst: boolean;
  /** win32: the PowerShell and cmd forms are in docs/cli.md. */
  windows: boolean;
}

export interface ImportantBoxOptions {
  /** Terminal columns; 0 or undefined: unknown. */
  columns: number | undefined;
  color: boolean;
  /** TERM=dumb: ASCII frame and "!" (04-REQ-65). */
  ascii: boolean;
}

/** Width of the box: the terminal, at most 80 and at least 40; 80 when unknown. */
export function importantBoxWidth(columns: number | undefined): number {
  const known = columns !== undefined && columns > 0 ? columns : IMPORTANT_BOX_MAX_WIDTH;
  return Math.min(IMPORTANT_BOX_MAX_WIDTH, Math.max(MIN_WIDTH, known));
}

/** The IMPORTANT box; every line ends with a newline. */
export function importantBox(input: ImportantBoxInput, opts: ImportantBoxOptions): string {
  const { t, commands, reportDir } = input;
  const point = (n: number, text: string): BoxLine => ({ text: `${n}. ${text}`, indent: INDENT });
  const command = (text: string): BoxLine => ({
    text: `${' '.repeat(INDENT)}${text}`,
    style: 'cyan',
    indent: INDENT,
  });
  const under = (text: string): BoxLine => ({
    text: `${' '.repeat(INDENT)}${text}`,
    indent: INDENT,
  });
  const lines: BoxLine[] = [
    { text: t('importantIntro'), style: 'bold' },
    ...(input.fixFirst ? [{ text: t('importantFixFirst'), style: 'red' } as const] : []),
    { text: '' },
    point(1, t('importantThresholds')),
    command(commands.thresholds),
    { text: '' },
    point(2, t('importantDownload', { dir: reportDir })),
    { text: '' },
    point(3, t('importantCommit', { files: input.files.join(', ') })),
    { text: '' },
    point(4, t('importantTest')),
    command(commands.test),
    under(
      t('importantResults', {
        report: `${reportDir}/report.html`,
        outcome: `${reportDir}/outcome.json`,
      }),
    ),
    ...(input.windows ? [{ text: '' }, { text: t('windowsNote'), style: 'dim' } as const] : []),
  ];
  return box(lines, {
    width: importantBoxWidth(opts.columns),
    color: opts.color,
    ascii: opts.ascii,
    border: 'yellow',
    title: `${marks(opts.ascii).warn} ${t('importantTitle')}`,
    wrap: true,
  });
}
