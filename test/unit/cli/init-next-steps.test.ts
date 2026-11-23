// The IMPORTANT box at the end of the wizard (04-REQ-59, 04-D-56). Golden files hold the box of
// every language at 80 columns without colors: test/golden/init/important.<lang>.w80.txt.
// GOLDEN_UPDATE=1 rewrites them (12-REQ-16); the diff must be reviewed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCommands } from '../../../src/cli/init/commands.ts';
import { LANGUAGES, MESSAGES, translator } from '../../../src/cli/init/messages.ts';
import type { WizardLanguage } from '../../../src/cli/init/messages.ts';
import { importantBox, importantBoxWidth } from '../../../src/cli/init/next-steps.ts';
import type { ImportantBoxInput } from '../../../src/cli/init/next-steps.ts';
import { stripAnsi } from '../../../src/console/color.ts';
import { textWidth } from '../../../src/console/text.ts';
import { INIT_GOLDEN } from './init-helpers.ts';

const update = process.env['GOLDEN_UPDATE'] === '1';

function input(lang: WizardLanguage, more: Partial<ImportantBoxInput> = {}): ImportantBoxInput {
  return {
    t: translator(lang),
    commands: runCommands('npm run e2e:qa', 'linux'),
    files: ['pw-perf-thresholds.json', 'pw-perf-thresholds.steps.json'],
    reportDir: 'reports/pw-perf',
    fixFirst: false,
    windows: false,
    ...more,
  };
}

const plain = { columns: 80, color: false, ascii: false };

describe('init IMPORTANT box', () => {
  test('04-AC-67 the box of every language equals its golden file at 80 columns', () => {
    for (const lang of LANGUAGES) {
      const text = importantBox(input(lang), plain);
      const file = join(INIT_GOLDEN, `important.${lang}.w80.txt`);
      if (update) {
        writeFileSync(file, text);
        continue;
      }
      expect(existsSync(file), file).toBe(true);
      expect(text, lang).toBe(readFileSync(file, 'utf8'));
    }
  });

  test('04-AC-67 the four steps with the exact commands, files and report folder', () => {
    const text = importantBox(input('en'), plain);
    expect(text.split('\n')[0]).toMatch(/^╭─ ⚠ IMPORTANT ─+╮$/u);
    expect(text).toContain(
      '│ 1. Derive the thresholds on CI, on the environment where the tests will run',
    );
    expect(text).toContain('It can take several hours');
    expect(text).toContain('│    PW_PERF_MODE=thresholds npm run e2e:qa');
    expect(text).toContain('the report folder reports/pw-perf');
    expect(text).toContain('docs/ci.md');
    expect(text).toContain(
      '│ 3. Commit them: pw-perf-thresholds.json, pw-perf-thresholds.steps.json.',
    );
    expect(text).toContain('│    PW_PERF_MODE=test npm run e2e:qa');
    expect(text).toContain('reports/pw-perf/report.html');
    expect(text).not.toContain('First add the perf fixture');
    expect(text).not.toContain('PowerShell');
  });

  test('04-AC-67 every line fits 80 columns, also in a wider terminal and with long commands', () => {
    const long = runCommands(`npm run e2e -- ${'--grep "@smoke" '.repeat(8)}`.trim(), 'win32');
    for (const lang of LANGUAGES) {
      for (const columns of [80, 200, undefined, 0]) {
        const text = importantBox(input(lang, { commands: long, fixFirst: true, windows: true }), {
          ...plain,
          columns,
        });
        for (const line of text.trimEnd().split('\n')) {
          expect(textWidth(line), `${lang} ${String(columns)}: ${line}`).toBeLessThanOrEqual(80);
        }
      }
    }
    expect(importantBoxWidth(undefined)).toBe(80);
    expect(importantBoxWidth(0)).toBe(80);
    expect(importantBoxWidth(200)).toBe(80);
    expect(importantBoxWidth(60)).toBe(60);
    expect(importantBoxWidth(20)).toBe(40);
  });

  test('04-AC-67 titles have at most 48 characters (04-D-52)', () => {
    for (const lang of LANGUAGES) {
      expect(MESSAGES[lang].importantTitle.length, lang).toBeLessThanOrEqual(48);
    }
  });

  test('04-AC-67 TERM=dumb gives an ASCII frame with "!"; colors only when asked; fixture and Windows lines', () => {
    const ascii = importantBox(input('en'), { ...plain, ascii: true });
    expect(ascii.split('\n')[0]).toMatch(/^\+- ! IMPORTANT -+\+$/u);
    expect(ascii).not.toMatch(/[╭│⚠]/u);
    const colored = importantBox(input('en'), { ...plain, color: true });
    expect(colored).toContain('\u001b[');
    expect(stripAnsi(colored)).toBe(importantBox(input('en'), plain));
    const extra = importantBox(input('pl', { fixFirst: true, windows: true }), plain);
    expect(extra).toContain('Najpierw dodaj fixture perf (czerwona ramka wyżej)');
    expect(extra).toContain('Wersje tych poleceń dla PowerShell i cmd: docs/cli.md.');
  });
});
