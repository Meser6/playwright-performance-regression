// Framed blocks of the console output (04-REQ-65): rounded box-drawing frame, or an ASCII frame
// without emoji for TERM=dumb. Shared by the start banner and, later, the result (WP-26) and the
// init wizard (WP-22). Pure.
import { paint } from './color.ts';
import type { ColorStyle } from './color.ts';
import { padEnd, textWidth } from './text.ts';

export interface BoxOptions {
  /** Terminal width; the frame is at most this wide. */
  width: number;
  color: boolean;
  /** TERM=dumb: `+`, `-`, `|` and no emoji (04-REQ-65). */
  ascii: boolean;
  /** Color of the frame. */
  border: ColorStyle;
}

export interface BoxLine {
  text: string;
  style?: ColorStyle;
}

/** Whether the terminal only takes plain ASCII frames (TERM=dumb, 04-REQ-65). */
export function asciiTerminal(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.TERM === 'dumb';
}

/** Cuts `text` to `width` code points with "…" at the end. */
function cut(text: string, width: number): string {
  const chars = Array.from(text);
  if (chars.length <= width) return text;
  return width <= 1 ? '…'.slice(0, width) : `${chars.slice(0, width - 1).join('')}…`;
}

/** A framed block; every line ends with a newline. */
export function box(lines: readonly BoxLine[], opts: BoxOptions): string {
  const glyphs = opts.ascii
    ? { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' }
    : { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' };
  const longest = Math.max(0, ...lines.map((l) => textWidth(l.text)));
  const inner = Math.max(1, Math.min(longest, Math.max(1, opts.width - 4)));
  const border = (text: string): string => paint(text, opts.border, opts.color);
  const out = [border(`${glyphs.tl}${glyphs.h.repeat(inner + 2)}${glyphs.tr}`)];
  for (const line of lines) {
    const text = padEnd(cut(line.text, inner), inner);
    const body = line.style === undefined ? text : paint(text, line.style, opts.color);
    out.push(`${border(glyphs.v)} ${body} ${border(glyphs.v)}`);
  }
  out.push(border(`${glyphs.bl}${glyphs.h.repeat(inner + 2)}${glyphs.br}`));
  return `${out.join('\n')}\n`;
}
