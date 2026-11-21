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

// Characters shown as emoji (two terminal columns) without a variation selector: ✅ ❌ ⭐ and the
// pictographs from U+1F300. Other characters take one column; U+FE0F after a character counts as
// one more column, so ⚠️ and ⏱️ take two (09-REQ-27).
const WIDE: readonly (readonly [number, number])[] = [
  [0x231a, 0x231b],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x26a1, 0x26a1],
  [0x26d4, 0x26d4],
  [0x2705, 0x2705],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x1f300, 0x1faff],
];

/** Terminal columns of one code point (09-REQ-27). */
export function charWidth(char: string): number {
  const cp = char.codePointAt(0) ?? 0;
  return WIDE.some(([from, to]) => cp >= from && cp <= to) ? 2 : 1;
}

/** Terminal columns of `text`: code points, with emoji counted as two (09-REQ-27). */
export function textWidth(text: string): number {
  let width = 0;
  for (const char of text) width += charWidth(char);
  return width;
}

export function padEnd(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - textWidth(text)));
}

export function padStart(text: string, width: number): string {
  return ' '.repeat(Math.max(0, width - textWidth(text))) + text;
}
