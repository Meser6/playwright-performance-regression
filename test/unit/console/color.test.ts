// Terminal color rules (04-REQ-44): one decision for the wizard, the CLI messages, the run summary
// and the thresholds diff.
import { describe, expect, test } from 'vitest';
import { colorEnabled, paint, stripAnsi } from '../../../src/console/color.ts';

const ESC = String.fromCharCode(27);
const tty = { isTTY: true };
const pipe = { isTTY: false };

describe('terminal colors', () => {
  test('04-AC-24 colors in a terminal without NO_COLOR; none with NO_COLOR, without a terminal or with TERM=dumb', () => {
    expect(colorEnabled(tty, {})).toBe(true);
    expect(colorEnabled(tty, { TERM: 'xterm-256color' })).toBe(true);
    expect(colorEnabled(tty, { NO_COLOR: '1' })).toBe(false);
    expect(colorEnabled(pipe, {})).toBe(false);
    expect(colorEnabled({}, {})).toBe(false);
    expect(colorEnabled(tty, { TERM: 'dumb' })).toBe(false);
  });

  test('04-AC-24 FORCE_COLOR other than 0 turns colors on without a terminal', () => {
    expect(colorEnabled(pipe, { FORCE_COLOR: '1' })).toBe(true);
    expect(colorEnabled(pipe, { FORCE_COLOR: '3' })).toBe(true);
    expect(colorEnabled(pipe, { FORCE_COLOR: '' })).toBe(true);
    expect(colorEnabled(pipe, { FORCE_COLOR: '1', TERM: 'dumb' })).toBe(true);
    expect(colorEnabled(pipe, { FORCE_COLOR: '0' })).toBe(false);
    expect(colorEnabled(tty, { FORCE_COLOR: '0' })).toBe(false);
    // NO_COLOR is the user's explicit choice and wins.
    expect(colorEnabled(tty, { FORCE_COLOR: '1', NO_COLOR: '1' })).toBe(false);
    // An empty NO_COLOR does not count (no-color.org).
    expect(colorEnabled(tty, { NO_COLOR: '' })).toBe(true);
  });

  test('04-AC-24 painted text equals the plain text after removing the ANSI sequences', () => {
    for (const style of ['green', 'red', 'yellow', 'cyan', 'dim', 'bold'] as const) {
      const colored = paint('✔ done', style, true);
      expect(colored).toMatch(new RegExp(`^${ESC}\\[\\d+m✔ done${ESC}\\[0m$`, 'u'));
      expect(stripAnsi(colored)).toBe('✔ done');
      expect(paint('✔ done', style, false)).toBe('✔ done');
    }
  });

  test('09-AC-21 verdict badges: bold text on a colored background, magenta for ERROR', () => {
    const badges = {
      'badge-green': '1;30;42',
      'badge-yellow': '1;30;43',
      'badge-red': '1;97;41',
      'badge-magenta': '1;97;45',
    } as const;
    for (const [style, sgr] of Object.entries(badges)) {
      const colored = paint(' ✖ ERROR ', style as keyof typeof badges, true);
      expect(colored).toBe(`${ESC}[${sgr}m ✖ ERROR ${ESC}[0m`);
      expect(stripAnsi(colored)).toBe(' ✖ ERROR ');
    }
    expect(paint('x', 'magenta', true)).toBe(`${ESC}[35mx${ESC}[0m`);
  });
});
