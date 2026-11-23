import { describe, expect, test } from 'vitest';
import { box, boxLines, marks, table } from '../../../src/console/box.ts';
import { stripAnsi } from '../../../src/console/color.ts';
import { clusters, textWidth, truncateMiddle } from '../../../src/console/text.ts';

// The shared frame module (04-REQ-65, 09-REQ-27).
describe('console frames and tables', () => {
  const opts = { width: 40, color: false, ascii: false, border: 'cyan' as const };

  test('09-REQ-27 emoji take two terminal columns, ⚠ without U+FE0F one', () => {
    expect(textWidth('✅')).toBe(2);
    expect(textWidth('❌')).toBe(2);
    expect(textWidth('⚠️')).toBe(2);
    expect(textWidth('⚠')).toBe(1);
    expect(textWidth('⏳ pw-perf')).toBe(10);
    expect(marks(false)).toEqual({ ok: '✅', warn: '⚠', error: '❌' });
    expect(marks(true)).toEqual({ ok: '✔', warn: '!', error: '✖' });
  });

  test('09-REQ-27 09-D-23 widths follow wcwidth: U+FE0F sequences two, joiners and marks zero', () => {
    expect(textWidth('⏱️')).toBe(2);
    expect(textWidth('⏱')).toBe(1);
    expect(textWidth('✅️')).toBe(2);
    expect(textWidth('\uFE0F')).toBe(0);
    expect(textWidth('e\u0301')).toBe(1);
    expect(textWidth('👩‍💻')).toBe(2);
    expect(textWidth('👍🏽')).toBe(2);
    expect(textWidth('1️⃣')).toBe(2);
    expect(textWidth('⏳ ✅ ❌ ⚠ ✔ ✖ · × …')).toBe(20);
    expect(clusters('a⏱️b').map((c) => c.text)).toEqual(['a', '⏱️', 'b']);
    expect(truncateMiddle('⏱️abcdef⏱️', 6)).toBe('⏱️a…⏱️');
    expect(textWidth(truncateMiddle('✅✅✅✅✅', 6))).toBeLessThanOrEqual(6);
  });

  test('09-D-23 an emoji sequence is never cut apart and every frame line closes', () => {
    const lines = boxLines([{ text: 'ab⏱️cd' }, { text: '⏳ x' }], { ...opts, width: 7 });
    expect(lines.map(textWidth)).toEqual([7, 7, 7, 7]);
    expect(lines[1]).toBe('│ ab… │');
    const wide = boxLines([{ text: '⚠️ ⏱️ 👩‍💻' }], opts);
    expect(new Set(wide.map(textWidth)).size).toBe(1);
  });

  test('a box with a title in the top edge closes on every line', () => {
    const lines = boxLines([{ text: '❌ one' }, { text: 'two' }], { ...opts, title: 'Errors (2)' });
    expect(lines[0]).toBe('╭─ Errors (2) ──╮');
    expect(lines.map(textWidth)).toEqual([17, 17, 17, 17]);
    expect(lines[1]).toBe('│ ❌ one        │');
  });

  test('wrap breaks long lines at spaces with the continuation indent; without wrap they are cut', () => {
    const text = 'CODE: aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii';
    const wrapped = boxLines([{ text, indent: 2 }], { ...opts, width: 24, wrap: true });
    expect(wrapped).toEqual([
      '╭──────────────────────╮',
      '│ CODE: aaaa bbbb cccc │',
      '│   dddd eeee ffff     │',
      '│   gggg hhhh iiii     │',
      '╰──────────────────────╯',
    ]);
    expect(box([{ text }], { ...opts, width: 24 })).toContain('│ CODE: aaaa bbbb ccc… │');
  });

  test('ASCII frames for TERM=dumb', () => {
    expect(boxLines([{ text: 'x' }], { ...opts, ascii: true, title: 'T' })).toEqual([
      '+- T --+',
      '| x    |',
      '+------+',
    ]);
    const t = table([{ header: 'a' }, { header: 'n', align: 'right' }], [{ cells: ['x', '7'] }], {
      width: 40,
      color: false,
      ascii: true,
    });
    expect(t).toEqual(['+---+---+', '| a | n |', '+---+---+', '| x | 7 |', '+---+---+']);
  });

  test('a table fits the width by shortening the flexible column in the middle', () => {
    const lines = table(
      [{ header: '' }, { header: 'key', flex: true, minWidth: 5 }, { header: 'n', align: 'right' }],
      [
        { cells: ['❌', 'GET /api/a/very/long/key', '12'], style: 'red' },
        { cells: ['⚠', 'GET /b', '3'] },
      ],
      { width: 30, color: true, ascii: false },
    ).map(stripAnsi);
    expect(lines).toEqual([
      '┌────┬──────────────────┬────┐',
      '│    │ key              │  n │',
      '├────┼──────────────────┼────┤',
      '│ ❌ │ GET /api…ong/key │ 12 │',
      '│ ⚠  │ GET /b           │  3 │',
      '└────┴──────────────────┴────┘',
    ]);
  });
});
