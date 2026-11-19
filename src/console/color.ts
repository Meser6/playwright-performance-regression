// Terminal colors (04-REQ-44): 16 ANSI colors with a fixed meaning, used by the init wizard, the
// CLI messages, the run summary and the thresholds diff. Colors never carry information alone
// (symbols and words stay), so the text without them is the same apart from the ANSI sequences.
// Pure: the caller passes the stream and the environment.

/** green: success/passed, red: error/blocking, yellow: warning, cyan: step headers and command
 * names, dim: explanations and default values, bold: emphasis (questions, file names). */
export type ColorStyle = 'green' | 'red' | 'yellow' | 'cyan' | 'dim' | 'bold';

const ANSI: Record<ColorStyle, string> = {
  green: '\u001b[32m',
  red: '\u001b[31m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
  dim: '\u001b[2m',
  bold: '\u001b[1m',
};
const RESET = '\u001b[0m';

/**
 * Whether output on `stream` gets colors: never with a non-empty NO_COLOR; with FORCE_COLOR other
 * than "0" also without a terminal; FORCE_COLOR=0 turns them off; otherwise only in a terminal
 * whose TERM is not "dumb".
 */
export function colorEnabled(
  stream: { isTTY?: boolean | undefined },
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if ((env.NO_COLOR ?? '') !== '') return false;
  const force = env.FORCE_COLOR;
  if (force !== undefined) return force !== '0';
  return stream.isTTY === true && env.TERM !== 'dumb';
}

/** `text` in `style` when `enabled`, otherwise unchanged. */
export function paint(text: string, style: ColorStyle, enabled: boolean): string {
  return enabled && text !== '' ? `${ANSI[style]}${text}${RESET}` : text;
}

/** A painter bound to one color decision. */
export type Painter = (text: string, style: ColorStyle) => string;

export function painter(enabled: boolean): Painter {
  return (text, style) => paint(text, style, enabled);
}

// eslint-disable-next-line no-control-regex
const SEQUENCE = /\u001b\[[0-9;]*m/gu;

/** Removes the SGR sequences written by paint. */
export function stripAnsi(text: string): string {
  return text.replace(SEQUENCE, '');
}
