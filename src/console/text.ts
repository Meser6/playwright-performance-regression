// Text helpers of the console output (01, chapter 4.9): widths in code points, padding,
// truncation in the middle and plurals.

/** Code unit order, never localeCompare (02-REQ-04). */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

/** Shortens text to `width` code points with "…" in the middle (01, chapter 4.9). */
export function truncateMiddle(text: string, width: number): string {
  const chars = Array.from(text);
  if (chars.length <= width) return text;
  if (width <= 1) return '…'.slice(0, width);
  const head = Math.ceil((width - 1) / 2);
  const tail = width - 1 - head;
  return `${chars.slice(0, head).join('')}…${tail === 0 ? '' : chars.slice(-tail).join('')}`;
}

export function textWidth(text: string): number {
  return Array.from(text).length;
}

export function padEnd(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - textWidth(text)));
}

export function padStart(text: string, width: number): string {
  return ' '.repeat(Math.max(0, width - textWidth(text))) + text;
}
