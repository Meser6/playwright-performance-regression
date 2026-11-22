// Visual design of the HTML report (11, chapter 8a, D-36): colour tokens and their contrast, the
// layout parts of the full-run golden page, the icon sprite, empty states and warnings.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { RunReport } from '../../../src/core/types/index.ts';
import { renderHtmlReport } from '../../../src/html/index.ts';
import { ICON_NAMES } from '../../../src/html/icons.ts';
import { GOLDEN_DIR } from '../../contract/golden.ts';
import { HTML_PAGE, fullRun, readCase, stepsRun } from './fixtures.ts';

const CSS = readFileSync(
  join(import.meta.dirname, '../../../src/html/template/styles.css'),
  'utf8',
);

/** Custom properties of the first `:root { … }` after `from` in the stylesheet. */
function tokens(from: number): Record<string, string> {
  const start = CSS.indexOf(':root {', from);
  const body = CSS.slice(start, CSS.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/gu)].map((m) => [m[1], (m[2] ?? '').trim()]),
  );
}

const LIGHT = tokens(0);
const DARK = tokens(CSS.indexOf('@media screen and (prefers-color-scheme: dark)'));

/** The token table of 11-REQ-48: name → [light, dark]. */
const TABLE: Record<string, [string, string]> = {
  '--bg': ['#f6f7f9', '#0b0d12'],
  '--surface': ['#ffffff', '#12151c'],
  '--sunken': ['#f1f3f6', '#0e1117'],
  '--line': ['#e4e7ec', '#232836'],
  '--line-2': ['#d0d5dd', '#323949'],
  '--fg': ['#101828', '#e7e9ef'],
  '--fg-2': ['#475467', '#a9b0bf'],
  '--fg-3': ['#5d6979', '#8e97a8'],
  '--accent': ['#4f46e5', '#8b93ff'],
  '--ok': ['#067647', '#47cd89'],
  '--ok-soft': ['#e6f6ee', '#0f2a1f'],
  '--ok-mark': ['#079455', '#2fbf71'],
  '--warn': ['#a14c05', '#fdb022'],
  '--warn-soft': ['#fef4e4', '#2e2210'],
  '--warn-mark': ['#d06306', '#f79009'],
  '--bad': ['#b42318', '#f97066'],
  '--bad-mark': ['#d92d20', '#f04438'],
  '--bad-soft': ['#fef3f2', '#2d1214'],
  '--bad-solid': ['#b42318', '#d92d20'],
  '--mute': ['#5d6979', '#98a2b3'],
  '--mute-soft': ['#eef0f3', '#1c212b'],
  '--mute-mark': ['#7a8494', '#667085'],
  '--bar': ['#848ea0', '#6b7589'],
  '--bar-hi': ['#5162e8', '#8b93ff'],
  '--track': ['#eceef2', '#1f2430'],
  '--get': ['#175cd3', '#84adff'],
  '--get-bg': ['#e9f1fe', '#14223f'],
  '--post': ['#067647', '#47cd89'],
  '--post-bg': ['#e6f6ee', '#0f2a1f'],
  '--put': ['#a14c05', '#fdb022'],
  '--put-bg': ['#fef4e4', '#2e2210'],
  '--patch': ['#6938ef', '#bdb4fe'],
  '--patch-bg': ['#f1edfe', '#231b45'],
  '--del': ['#b42318', '#f97066'],
  '--del-bg': ['#fef3f2', '#2d1214'],
};

/** Relative luminance of a #rrggbb colour (WCAG 2.1). */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

describe('tokens and contrast (11-REQ-48)', () => {
  test('11-AC-33 every token of the table is defined in both themes with its value', () => {
    for (const [name, [light, dark]] of Object.entries(TABLE)) {
      expect(LIGHT[name], `${name} light`).toBe(light);
      expect(DARK[name], `${name} dark`).toBe(dark);
    }
  });

  test('11-AC-33 text pairs reach 4.5:1 and marks 3:1 in both themes', () => {
    const failures: string[] = [];
    for (const [theme, t] of [
      ['light', LIGHT],
      ['dark', DARK],
    ] as const) {
      const v = (name: string) => t[name] ?? LIGHT[name] ?? '';
      const check = (fg: string, bg: string, min: number) => {
        const ratio = contrast(fg.startsWith('#') ? fg : v(fg), v(bg));
        if (ratio < min) failures.push(`${theme} ${fg} on ${bg}: ${ratio.toFixed(2)}`);
      };
      for (const text of ['--bad', '--fg-2', '--fg-3', '--ok', '--warn', '--accent']) {
        check(text, '--surface', 4.5);
        check(text, '--bg', 4.5);
      }
      check('--bad', '--bad-soft', 4.5);
      check('--ok', '--ok-soft', 4.5);
      check('--warn', '--warn-soft', 4.5);
      check('--accent', '--accent-soft', 4.5);
      check('--mute', '--mute-soft', 4.5);
      check('#ffffff', '--bad-solid', 4.5);
      for (const mark of ['--bad-mark', '--ok-mark', '--warn-mark', '--mute-mark', '--bar']) {
        check(mark, '--surface', 3);
      }
      for (const m of ['get', 'post', 'put', 'patch', 'del']) check(`--${m}`, `--${m}-bg`, 4.5);
    }
    expect(failures).toEqual([]);
  });

  test('11-AC-33 the stylesheet has no colour values outside the token definitions', () => {
    // Without the token blocks, comments and the white text of the solid pill.
    const rules = CSS.replace(/\/\*.*?\*\//gsu, '')
      .replace(/:root \{[^}]*\}/gu, '')
      .replace('.pill.fb {\n  background: var(--bad-solid);\n  color: #ffffff;', '');
    expect(rules.match(/#[0-9a-f]{3,8}\b/giu) ?? []).toEqual([]);
    // Only translucent shades (the backdrop of the dialog) besides tokens.
    for (const m of rules.matchAll(/(?:rgba?|hsla?)\([^)]*\)/gu)) {
      expect(m[0], m[0]).toMatch(/\/\s*\d+%?\)$/u);
    }
  });
});

describe('layout (11-REQ-49 – 11-REQ-55)', () => {
  const page = readFileSync(join(HTML_PAGE, 'full-run.html'), 'utf8');

  test('11-AC-34 app bar chips, verdict card with three results, KPI fields', () => {
    const bar = /<header class="appbar">.*?<\/header>/su.exec(page)?.[0] ?? '';
    for (const icon of ['env', 'play', 'clock', 'branch']) {
      expect(bar, icon).toContain(`<use href="#i-${icon}"/>`);
    }
    expect(bar).toContain('env <b>qa</b>');
    expect(bar).toContain('mode <b>test</b>');
    expect(bar).toContain('<b>main</b> @ abc123');
    expect(bar).toContain('<span class="sr">Run ID </span>run-1</span>');
    expect(page).toMatch(/<section class="hero t-bad" aria-labelledby="vh">/u);
    expect(page.match(/<div class="ss"><dt>/gu)).toHaveLength(3);
    const fields = [...page.matchAll(/<div class="kpi[^"]*"><dt>(.*?)<\/dt>/gu)].map((m) => m[1]);
    expect(fields).toEqual([
      'Endpoints',
      'Tests',
      'Violations',
      'Error rate',
      'Duration',
      'Passes',
    ]);
    const steps = renderHtmlReport(stepsRun());
    expect([...steps.matchAll(/<div class="kpi[^"]*"><dt>(.*?)<\/dt>/gu)].map((m) => m[1])[1]).toBe(
      'Steps',
    );
  });

  test('11-AC-34 violation cards, ranking switch, row classes, table footer, meters and width classes', () => {
    expect(page).toContain('<article class="card vio">');
    const steps = renderHtmlReport(stepsRun());
    expect(steps).toMatch(
      /<div class="toggle js-only" role="group" aria-label="Key kind in the rankings" data-kinds="" hidden><button type="button" aria-pressed="true" data-k="api">Endpoints<\/button><button type="button" aria-pressed="false" data-k="step">Steps<\/button><\/div>/u,
    );
    expect(page).toContain('<tr class="blocking"><th scope="row" class="k">');
    expect(page).toContain('<p class="tfoot">All times in ms · ');
    // Time cells of key tables are whole ms without a unit.
    const row = /<tr class="pass">(.*?)<\/tr>/su.exec(page)?.[1] ?? '';
    expect(row).not.toMatch(/\d ms</u);
    expect(page).not.toContain('low="0.8"');
    expect(page).toContain('<meter max="1.25" low="0.9" high="1" optimum="0"');
    expect(page).toMatch(/class="(?:s-\w+ )?w-\d{1,3}"/u);
    for (const m of page.matchAll(/\bw-(\d+)\b/gu)) expect(Number(m[1]) % 5).toBe(0);
    expect(page.replace(/"[^"]*"/gu, '""')).not.toMatch(/<[a-z]+\s[^>]*\sstyle=/u);
  });
});

describe('icons (11-REQ-59)', () => {
  test('11-AC-35 every <use> points to a symbol of the sprite; icon-only buttons have a name', () => {
    const symbols = new Set(ICON_NAMES.map((n) => `i-${n}`));
    for (const name of ['full-run', 'empty-run', 'migrated-v1', 'no-thresholds-files']) {
      const page = readFileSync(join(HTML_PAGE, `${name}.html`), 'utf8');
      const defined = new Set([...page.matchAll(/<symbol id="([^"]+)"/gu)].map((m) => m[1]));
      expect(defined, name).toEqual(symbols);
      for (const m of page.matchAll(/<use href="#(i-[^"]+)"/gu)) {
        expect(defined.has(m[1]), `${name}: ${m[1] ?? ''}`).toBe(true);
      }
      // Buttons whose only content is an icon carry aria-label.
      for (const m of page.matchAll(
        /<button([^>]*)>(<svg class="i"[^>]*><use[^>]*\/><\/svg>)<\/button>/gu,
      )) {
        expect(m[1], name).toMatch(/aria-label="[^"]+"/u);
      }
      expect(page, name).not.toMatch(/@font-face|<img|url\(/u);
    }
  });
});

describe('logo (11-REQ-49, v4 E3)', () => {
  test('11-AC-39 a stopwatch logo in the header and as a data: favicon, no external files', () => {
    const page = readFileSync(join(HTML_PAGE, 'full-run.html'), 'utf8');
    const header = /<header[^>]*>.*?<\/header>/su.exec(page)?.[0] ?? '';
    const logos = [...header.matchAll(/<svg class="logo"[^>]*>.*?<\/svg>/gsu)].map((m) => m[0]);
    expect(logos).toHaveLength(1);
    expect(logos[0]).toContain('aria-hidden="true"');
    expect(logos[0]).toContain('<circle');
    const head = /<head>.*?<\/head>/su.exec(page)?.[0] ?? '';
    const icons = [...head.matchAll(/<link rel="icon"[^>]*href="([^"]+)"/gu)].map((m) => m[1]);
    expect(icons).toHaveLength(1);
    expect(icons[0]).toMatch(/^data:image\/svg\+xml,%3Csvg%20/u);
    expect(decodeURIComponent((icons[0] ?? '').slice('data:image/svg+xml,'.length))).toContain(
      '<circle cx="12" cy="14" r="8.5"',
    );
    // Nothing is loaded from a file: every <link> and src is a data: URI; the CSP is unchanged.
    for (const m of page.matchAll(/<link[^>]*\shref="([^"]*)"|\ssrc="([^"]*)"/gu)) {
      expect(m[1] ?? m[2], m[0]).toMatch(/^data:/u);
    }
    expect(page.replaceAll('&#39;', "'")).toMatch(
      /content="default-src 'none'; script-src 'sha256-[^']+'; style-src 'sha256-[^']+'; img-src data:"/u,
    );
  });
});

describe('empty states and warnings (11-REQ-45, 11-REQ-58)', () => {
  test('11-AC-36 the empty run has the empty-state block; filters have their empty state', () => {
    const page = readFileSync(join(HTML_PAGE, 'empty-run.html'), 'utf8');
    expect(page).toContain(
      '<div class="card empty"><span class="ei"><svg class="i" aria-hidden="true"><use href="#i-inbox"/></svg></span><h3>No requests or steps were recorded</h3>',
    );
    expect(readFileSync(join(HTML_PAGE, 'full-run.html'), 'utf8')).toContain(
      '<div class="empty sm" data-none hidden><svg class="i" aria-hidden="true"><use href="#i-search"/></svg><p>No keys match the filters</p><button type="button" class="btn sm" data-reset>Reset</button></div>',
    );
  });

  test('11-AC-36 Warnings: tool errors before warnings, each with code, message, hint and ×N', () => {
    const report: RunReport = readCase(
      join(GOLDEN_DIR, 'run-report', 'valid', 'empty-run.json'),
    ).input;
    report.warnings = [{ code: 'W_ONE', message: 'warn msg', hint: 'warn hint', count: 3 }];
    report.toolErrors = [{ code: 'E_ONE', message: 'error msg', hint: 'error hint' }];
    const page = renderHtmlReport(report);
    const panel =
      /<section class="panel" id="tab-warnings".*?<\/section><\/section>/su.exec(page)?.[0] ?? '';
    const cards = [...panel.matchAll(/<article class="card wn( err)?">(.*?)<\/article>/gsu)].map(
      (m) => [
        m[1] === undefined ? 'warning' : 'error',
        (m[2] ?? '').replace(/<[^>]+>/gu, '|').replace(/\|+/gu, '|'),
      ],
    );
    expect(cards).toEqual([
      ['error', '|E_ONE|×1|Tool error: |error msg|error hint|'],
      ['warning', '|W_ONE|×3|Warning: |warn msg|warn hint|'],
    ]);
    expect(panel).toContain('<p>1 tool error.</p>');
    const none = fullRun();
    expect(renderHtmlReport(none)).toContain('<p>No tool errors.</p>');
  });
});
