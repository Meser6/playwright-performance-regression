import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { stringifyStable } from '../../../src/core/format/index.ts';
import { parseRunReport } from '../../../src/core/schema/index.ts';
import type { RunReport } from '../../../src/core/types/index.ts';
import { escapeHtml, html, trustedHtml } from '../../../src/html/escape.ts';
import { formatDate, formatMs, formatRatio, truncateMiddle } from '../../../src/html/format.ts';
import {
  SCRIPT,
  SCRIPT_SHA256,
  STYLES,
  STYLES_SHA256,
} from '../../../src/html/generated/assets.ts';
import {
  CONTENT_SECURITY_POLICY,
  embeddedJson,
  renderHtmlReport,
  toHtmlReportData,
} from '../../../src/html/index.ts';
import { buildLink, defaultOrder } from '../../../src/html/render.ts';
import { generate } from '../../../scripts/build-html-assets.mjs';
import {
  HTML_DATA,
  HTML_PAGE,
  RUN_REPORTS,
  fullRun,
  largeReport,
  markupCase,
  migratedCase,
  pageCases,
  readCase,
  runReportNames,
} from './fixtures.ts';

// Golden files (12-REQ-14): test/golden/html/data/<name>.json holds the expected HtmlReportData of
// test/golden/run-report/valid/<name>.json; test/golden/html/page/<name>.html the expected page.
// GOLDEN_UPDATE=1 rewrites them (12-REQ-16); the diff must be reviewed.
const update = process.env['GOLDEN_UPDATE'] === '1';
const ROOT = join(fileURLToPath(import.meta.url), '../../../..');

function embedded(page: string): unknown {
  const match = /<script type="application\/json" id="report-data">(.*?)<\/script>/su.exec(page);
  if (match === null) throw new Error('no report-data element');
  return JSON.parse(match[1] ?? '');
}

/**
 * The full key in a details header (`.fk`) as escaped text: an endpoint is shown with its method
 * badge and origin token (11-REQ-53), whose text content is the key.
 */
function fkText(markup: string): string {
  return (/<code class="fk">(.*?)<\/code>/su.exec(markup)?.[1] ?? '').replace(/<[^>]+>/gu, '');
}

/** The table row of a key: the first <tr> of the tbody whose details show the key. */
function rowOf(page: string, key: string): string {
  const bodies = page.split('<tbody data-g=');
  const body = bodies.find((b) => fkText(b) === escapeHtml(key)) ?? '';
  return /<tr class="[^"]+">(.*?)<\/tr>/su.exec(body)?.[1] ?? '';
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('base64');
}

function withoutDurations(report: RunReport): unknown {
  const copy = JSON.parse(JSON.stringify(report)) as Record<string, Record<string, unknown>>;
  for (const kind of ['endpoints']) {
    for (const agg of Object.values(copy[kind] ?? {}) as { samples: Record<string, unknown> }[]) {
      const durations = agg.samples['durations'] as number[];
      agg.samples = { retained: durations.length, sampled: agg.samples['sampled'] };
    }
  }
  return copy;
}

describe('html golden files', () => {
  test('golden inputs are valid run reports', () => {
    for (const { name, report } of pageCases()) {
      expect(parseRunReport(stringifyStable(report), name).ok, name).toBe(true);
    }
  });

  test('11-AC-03 toHtmlReportData equals test/golden/html/data and drops only samples.durations', () => {
    for (const name of runReportNames()) {
      const source = readCase(join(RUN_REPORTS, `${name}.json`));
      const data = toHtmlReportData(source.input);
      const file = join(HTML_DATA, `${name}.json`);
      if (update) {
        writeFileSync(
          file,
          `${stringifyStable({ name: source.name, input: source.input, expected: data })}\n`,
        );
        continue;
      }
      expect(existsSync(file), file).toBe(true);
      const golden = JSON.parse(readFileSync(file, 'utf8')) as {
        input: unknown;
        expected: unknown;
      };
      expect(golden.input, `${name}: input equals the run report case`).toEqual(source.input);
      expect(data, name).toEqual(golden.expected);
      expect(JSON.stringify(data)).not.toContain('"durations"');
      expect(data).toEqual(withoutDurations(source.input));
    }
  });

  test('11-AC-03 the page embeds exactly the HtmlReportData (11-REQ-05, 11-REQ-06)', () => {
    for (const { name, report } of pageCases()) {
      expect(embedded(renderHtmlReport(report)), name).toEqual(
        JSON.parse(JSON.stringify(toHtmlReportData(report))),
      );
    }
  });

  test('12-REQ-14 renderHtmlReport equals test/golden/html/page/<name>.html', () => {
    for (const { name, report } of pageCases()) {
      const page = renderHtmlReport(report);
      const file = join(HTML_PAGE, `${name}.html`);
      if (update) {
        writeFileSync(file, page);
        continue;
      }
      expect(existsSync(file), file).toBe(true);
      expect(page === readFileSync(file, 'utf8'), `${name}: page differs from ${file}`).toBe(true);
    }
  });
});

describe('renderHtmlReport', () => {
  test('11-AC-02 the same report gives the same text, independent of key order, TZ and LANG', () => {
    const report = fullRun();
    const page = renderHtmlReport(report);
    expect(renderHtmlReport(report)).toBe(page);
    // The report read back from report.json (sorted keys) gives the same page.
    expect(renderHtmlReport(JSON.parse(stringifyStable(report)) as RunReport)).toBe(page);
    const reversed = JSON.parse(
      JSON.stringify(report, (_k, v: unknown) =>
        v !== null && typeof v === 'object' && !Array.isArray(v)
          ? Object.fromEntries(Object.entries(v).reverse())
          : v,
      ),
    ) as RunReport;
    expect(renderHtmlReport(reversed)).toBe(page);

    const script = [
      `import { readFileSync } from 'node:fs';`,
      // A file URL: an absolute Windows path (D:\\...) is not a valid import specifier.
      `import { renderHtmlReport } from ${JSON.stringify(pathToFileURL(join(ROOT, 'src/html/index.ts')).href)};`,
      `const r = JSON.parse(readFileSync(${JSON.stringify(join(RUN_REPORTS, 'full-run.json'))}, 'utf8')).input;`,
      `process.stdout.write(renderHtmlReport(r));`,
    ].join('\n');
    for (const env of [
      { TZ: 'Pacific/Kiritimati', LANG: 'de_DE.UTF-8', LC_ALL: 'de_DE.UTF-8' },
      { TZ: 'America/Los_Angeles', LANG: 'ar_EG.UTF-8', LC_ALL: 'ar_EG.UTF-8' },
    ]) {
      const out = execFileSync(
        process.execPath,
        ['--no-warnings', '--input-type=module', '--experimental-strip-types', '-e', script],
        { env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 1 << 26 },
      );
      expect(out === page, `differs with ${env.TZ}`).toBe(true);
    }
  });

  test('11-REQ-06 every < of the embedded data is written as \\u003c', () => {
    const page = renderHtmlReport(markupCase());
    const data = /id="report-data">(.*?)<\/script>/su.exec(page)?.[1] ?? '';
    expect(data).not.toContain('<');
    expect(data).toContain('\\u003c/script>\\u003cscript>alert(1)');
    expect(embeddedJson(toHtmlReportData(markupCase()))).toBe(data);
  });

  test('11-REQ-09 default order: blocking, other violations, pass, not evaluated; ratio, then key', () => {
    const report = markupCase();
    const order = defaultOrder(toHtmlReportData(report).endpoints, 'p95');
    const page = renderHtmlReport(report);
    const table = page.slice(page.indexOf('id="table-api"'), page.indexOf('id="tab-tests"'));
    const rendered = [
      ...table.matchAll(
        /<tbody data-g="(\d)".*?<details id="key-api-(\d+)".*?(<code class="fk">.*?<\/code>)/gsu,
      ),
    ].map((m) => ({ key: fkText(m[3] ?? ''), n: Number(m[2]), group: Number(m[1]) }));
    expect(rendered.map((r) => r.key)).toEqual(order.map(escapeHtml));
    expect(rendered.map((r) => r.n)).toEqual(order.map((_, i) => i + 1));
    const groups = rendered.map((r) => r.group);
    expect([...groups].sort()).toEqual(groups);
    expect(groups[0]).toBe(0);
    // POST /api/reports/export fails but is muted: a non-blocking violation (group 1).
    expect(rendered.find((r) => r.key === 'POST /api/reports/export')?.group).toBe(1);
    expect(rendered.at(-1)).toMatchObject({ key: 'GET /api/rare', group: 3 });
    const ratios = (keys: string[]) =>
      keys.map((k) => {
        const agg = report.endpoints[k];
        return (agg?.stats?.percentiles['p95'] ?? 0) / (agg?.evaluation.limits.percentile ?? 1);
      });
    const blocking = order.filter(
      (k) => rendered.find((r) => r.key === escapeHtml(k))?.group === 0,
    );
    const r = ratios(blocking);
    expect([...r].sort((a, b) => b - a)).toEqual(r);
  });

  test('11-REQ-10 a key without successful samples shows — in the time columns and its reason', () => {
    const page = renderHtmlReport(fullRun());
    const row = rowOf(page, 'POST /api/orders');
    expect(row).toContain(
      '<td class="num">0 / 5</td><td class="num e">5</td><td class="num z">—</td><td class="num z">—</td><td class="num z">—</td><td class="num z">—</td><td class="num z">—</td>',
    );
    const rare = rowOf(renderHtmlReport(markupCase()), 'GET /api/rare');
    expect(rare).toContain('not evaluated');
    expect(rare).toContain('<small class="why">too few samples</small>');
  });

  test('11-REQ-21 report values are escaped; 11-REQ-22 raw URLs are text, never links', () => {
    const report = markupCase();
    const page = renderHtmlReport(report);
    const body = page.slice(0, page.indexOf('<script type="application/json"'));
    expect(body).toContain('GET /api/&lt;img src=x onerror=alert(1)&gt;');
    expect(body).toContain('&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(body).toContain('it&#39;s &lt;i&gt;quoted&lt;/i&gt;');
    expect(body).toContain('Old &lt;b&gt;note&lt;/b&gt; &amp; &quot;quotes&quot;');
    expect(body).toContain('feature/&lt;x&gt;');
    expect(body).not.toMatch(/<img|<i>quoted|<b>[^<]*note|alert\(1\)<\/script>/u);
    expect(page.match(/<script/gu)?.length).toBe(2);

    const raw = readCase(join(RUN_REPORTS, 'raw-urls-and-extra-percentile.json')).input;
    const urls = Object.values(raw.endpoints).flatMap((a) =>
      a.slowest.flatMap((s) => (s.url === undefined ? [] : [s.url])),
    );
    expect(urls.length).toBeGreaterThan(0);
    const rawPage = renderHtmlReport(raw);
    for (const url of urls) {
      expect(rawPage).toContain(`<span class="url">${escapeHtml(url)}</span>`);
      expect(rawPage).not.toContain(`href="${escapeHtml(url)}"`);
    }
    // Besides in-page anchors only the build URL and the footer link leave the page.
    expect(
      [...renderHtmlReport(fullRun()).matchAll(/<a href="([^"#][^"]*)"/gu)].map((m) => m[1]),
    ).toEqual([
      'https://github.com/o/r/actions/runs/1',
      'https://github.com/Meser6/playwright-performance-regression',
    ]);
  });

  test('11-REQ-22a ci.buildUrl is a link only for http(s) URLs', () => {
    expect(html`${buildLink('https://ci.example/1')}`.text).toBe(
      '<a href="https://ci.example/1" rel="noopener noreferrer">https://ci.example/1</a>',
    );
    expect(html`${buildLink('  HTTP://ci.example/"x"')}`.text).toBe(
      '<a href="  HTTP://ci.example/&quot;x&quot;" rel="noopener noreferrer">  HTTP://ci.example/&quot;x&quot;</a>',
    );
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,x',
      ' JavaScript:x',
      'ftp://x',
      '//x',
      'https:x',
    ]) {
      expect(html`${buildLink(url)}`.text, url).toBe(`<code>${escapeHtml(url)}</code>`);
    }
    expect(html`${buildLink(null)}`.text).toBe('—');
    const page = renderHtmlReport(markupCase());
    expect(page).toContain('<dd><code>javascript:alert(1)</code></dd>');
  });

  test('11-REQ-21 the html tag escapes by default; trustedHtml marks template markup', () => {
    expect(html`<p>${'<a href="x">&\'</a>'}</p>`.text).toBe(
      '<p>&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;</p>',
    );
    expect(html`${[1, null, undefined, false, ['a', trustedHtml('<br>')]]}`.text).toBe('1a<br>');
  });

  test('11-AC-11 the Muted keys section is hidden without mutings', () => {
    expect(renderHtmlReport(readCase(join(RUN_REPORTS, 'empty-run.json')).input)).not.toContain(
      'id="muted-h"',
    );
    const report = fullRun();
    for (const agg of Object.values(report.endpoints)) agg.evaluation.muted = null;
    expect(renderHtmlReport(report)).not.toContain('id="muted-h"');
  });

  test('11-AC-11 muted keys with note, until, violation; expired ones marked; active count equals muted', () => {
    const report = markupCase();
    const page = renderHtmlReport(report);
    const section = /<section aria-labelledby="muted-h">(.*?)<\/section>/su.exec(page)?.[1] ?? '';
    const rows = [
      ...section.matchAll(
        /<li><span class="tt"><a class="kl"[^>]*>(.*?)<\/a><span class="sub">(.*?)<\/span><\/span><span class="num">(.*?)<\/span><\/li>/gsu,
      ),
    ].map((m) => [
      (m[1] ?? '').replace(/<[^>]+>/gu, ''),
      m[2],
      (m[3] ?? '').replace(/<[^>]+>/gu, '|').replace(/\|+/gu, '|'),
    ]);
    expect(rows).toEqual([
      [
        'GET /api/users',
        'API · until 2026-01-31 · Old &lt;b&gt;note&lt;/b&gt; &amp; &quot;quotes&quot;',
        '|mute expired|no violation|',
      ],
      [
        'POST /api/reports/export',
        'API · until 2026-12-31 · Depends on report service, tracked in backlog',
        '|has violation|',
      ],
    ]);
    const active = report.evaluation.counts.api.muted;
    expect(section).toContain(`${active} active muting, 1 expired muting.</p>`);
    expect(section).toContain(`<span class="n">${active}</span>`);
    expect(page).toContain('>mute expired<');
    expect(page).toContain('>muted until 2026-12-31<');
  });

  test('11-REQ-08 verdict: three results with text; gate off in thresholds mode; failed-share note', () => {
    const page = renderHtmlReport(fullRun());
    const results = (html: string) =>
      [
        ...html.matchAll(
          /<div class="ss"><dt>(.*?)<\/dt><dd><span class="dot (d-\w+)"><\/span>(.*?)<\/dd><\/div>/gu,
        ),
      ].map((m) => [m[1], m[2], (m[3] ?? '').replace(/<[^>]+>/gu, '')]);
    expect(page).toContain('<dl class="subst">');
    expect(results(page)).toEqual([
      ['Performance', 'd-bad', 'failed 1 blocking · 1 muted'],
      ['Tests', 'd-ok', 'passed 3 test runs'],
      ['Tool errors', 'd-ok', 'none'],
    ]);
    const thresholds = renderHtmlReport(
      readCase(join(RUN_REPORTS, 'thresholds-mode-sparse-config.json')).input,
    );
    expect(thresholds).toContain('gate off (thresholds mode)');
    const report = fullRun();
    report.tests.status = 'timedout';
    report.toolErrors = [{ code: 'TESTS_FAILED_TOO_MANY', message: 'too many', hint: 'fix' }];
    report.evaluation.status = 'error';
    const error = renderHtmlReport(report);
    expect(results(error)).toEqual([
      ['Performance', 'd-bad', 'error 1 blocking · 1 muted'],
      ['Tests', 'd-warn', 'timed out 3 test runs · too many failed: result not trustworthy'],
      ['Tool errors', 'd-bad', '1'],
    ]);
    expect(error).toContain('class="wl hl-err"');
  });

  test('11 chapter 12: an empty run shows a message instead of tables and rankings', () => {
    const page = renderHtmlReport(readCase(join(RUN_REPORTS, 'empty-run.json')).input);
    expect(page).toContain('<h3>No requests or steps were recorded</h3>');
    expect(page).toContain('>Read the setup guide</a>');
    expect(page).not.toContain('<table class="keys"');
    expect(page).not.toContain('id="rank-h"');
    expect(page).toContain('No test made backend requests in measured projects.');
  });

  test('11 chapter 12: an evaluated percentile outside p50/p90/p95/p99 gets its own column', () => {
    const report = readCase(join(RUN_REPORTS, 'raw-urls-and-extra-percentile.json')).input;
    const percentile = report.config.checks?.time?.percentile;
    if (percentile !== undefined) percentile.level = 'p99.9';
    const page = renderHtmlReport(report);
    expect(page).toContain('<button type="button">p99.9 / limit</button>');
    expect(page).not.toContain('>p95 / limit<');
    const value = report.endpoints['GET /api/tickets/:id']?.stats?.percentiles['p99.9'] ?? 0;
    expect(page).toContain(`>${Math.round(value)}<span class="lim"> / `);
  });

  test('11 chapter 12: keys longer than 80 characters are shortened, full in title and details', () => {
    const report = fullRun();
    const long = `GET /api/${'x'.repeat(1990)}`;
    report.endpoints[long] = report.endpoints[
      'GET /api/tickets/:id'
    ] as RunReport['endpoints'][string];
    const page = renderHtmlReport(report);
    const short = truncateMiddle(long, 80);
    expect(Array.from(short)).toHaveLength(80);
    const path = long.slice(4);
    const shortPath = truncateMiddle(path, 80 - 4);
    expect(page).toContain(`<span class="key" title="${long}">${shortPath}</span>`);
    expect(Array.from(`GET ${shortPath}`)).toHaveLength(80);
    expect(short.length).toBeGreaterThan(0);
    expect(page).toContain(
      `<code class="fk"><b class="m GET">GET</b> <span class="key">${path}</span></code>`,
    );
  });

  test('11-REQ-11 a migrated report shows the percentile bar instead of the histogram', () => {
    const page = renderHtmlReport(migratedCase());
    const svg = /<svg class="bar"[^>]*aria-label="([^"]*)"/u.exec(page)?.[1] ?? '';
    expect(svg).toBe(
      'Percentiles and limits: p50 180 ms, p90 210 ms, p95 250 ms, p99 250 ms, max 250 ms, T 500 ms, median limit 900 ms, p95 limit 1400 ms, p99 limit 2100 ms',
    );
    expect(page).toContain('>p95, p99, max 250 ms</text>');
    expect(page).not.toContain('class="hist"');
    expect(renderHtmlReport(fullRun())).not.toContain('class="bar"');
  });

  test('11-REQ-19 numbers and dates do not depend on the locale', () => {
    expect(formatMs(0.04)).toBe('0.0 ms');
    expect(formatMs(9.94)).toBe('9.9 ms');
    expect(formatMs(9.96)).toBe('10.0 ms');
    expect(formatMs(10)).toBe('10 ms');
    expect(formatMs(1234.5)).toBe('1235 ms');
    expect(formatMs(9999.4)).toBe('9999 ms');
    expect(formatMs(10_000)).toBe('10.0 s');
    expect(formatMs(12_345)).toBe('12.3 s');
    expect(formatRatio(0.85)).toBe('0.850');
    expect(formatRatio(0.12345)).toBe('0.123');
    expect(formatDate('2026-11-18T10:01:00.123Z')).toBe('2026-11-18 10:01:00 UTC');
    expect(formatDate('2026-11-18T12:01:00+02:00')).toBe('2026-11-18 10:01:00 UTC');
    expect(formatDate('not a date')).toBe('not a date');
  });

  test('11-REQ-20 the footer only links the project page', () => {
    const page = renderHtmlReport(fullRun());
    expect(page).toContain(
      '<footer><div class="wrap">Generated by <a href="https://github.com/Meser6/playwright-performance-regression" rel="noopener noreferrer">playwright-performance-regression</a> v0.1.0</div></footer>',
    );
    expect(page).not.toMatch(/waitlist|\bPro\b/u);
  });

  test('11-REQ-01 the page loads nothing from outside: no src, no external href, no @import', () => {
    for (const { report } of pageCases()) {
      // Attribute values are escaped text; only attribute names matter here.
      const page = renderHtmlReport(report).replace(/"[^"]*"/gu, '""');
      expect(page).not.toMatch(/<[a-z]+\s[^>]*\bsrc=/u);
      expect(renderHtmlReport(report)).not.toMatch(/<link(?![^>]*href="data:)/u);
      expect(STYLES).not.toMatch(/@import|url\(/u);
    }
  });

  test('11-REQ-23 CSP: default-src none, script and style by SHA-256 of the embedded text', () => {
    expect(SCRIPT_SHA256).toBe(sha256(SCRIPT));
    expect(STYLES_SHA256).toBe(sha256(STYLES));
    expect(CONTENT_SECURITY_POLICY).toBe(
      `default-src 'none'; script-src 'sha256-${SCRIPT_SHA256}'; style-src 'sha256-${STYLES_SHA256}'; img-src data:`,
    );
    const page = renderHtmlReport(fullRun());
    expect(page).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(CONTENT_SECURITY_POLICY)}">`,
    );
    const style = /<style>(.*?)<\/style>/su.exec(page)?.[1];
    const script = /<script>(.*?)<\/script>/su.exec(page)?.[1];
    expect(style !== undefined && sha256(style)).toBe(STYLES_SHA256);
    expect(script !== undefined && sha256(script)).toBe(SCRIPT_SHA256);
    expect(page.replace(/"[^"]*"/gu, '""')).not.toMatch(/<[a-z]+\s[^>]*\s(?:style|on[a-z]+)=/u);
  });

  test('11-AC-09 the page script calls none of innerHTML, outerHTML, insertAdjacentHTML, document.write, eval, new Function', () => {
    const source = readFileSync(join(ROOT, 'src/html/template/app.ts'), 'utf8');
    for (const text of [source, SCRIPT]) {
      expect(text).not.toMatch(
        /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\b|new Function|\bFunction\(/u,
      );
    }
    expect(source).not.toMatch(/^\s*import\s/mu);
  });

  test('11-REQ-24 the generated assets are up to date with src/html/template; 11-REQ-25 below 60 kB', async () => {
    expect(await generate()).toBe(readFileSync(join(ROOT, 'src/html/generated/assets.ts'), 'utf8'));
    expect(Buffer.byteLength(SCRIPT) + Buffer.byteLength(STYLES)).toBeLessThan(60 * 1024);
  });

  test('11-AC-04 500 keys with 3 slowest samples, all checks and 5000 retained samples: below 10 MB', () => {
    const report = largeReport(500, 5000);
    expect(parseRunReport(stringifyStable(report), 'large').ok).toBe(true);
    const page = renderHtmlReport(report);
    expect(Buffer.byteLength(page)).toBeLessThan(10 * 1024 * 1024);
    expect(stringifyStable(report).length).toBeGreaterThan(5 * 1024 * 1024);
  }, 60_000); // builds 2.5 M samples: slow on shared CI runners; this test checks size, not time
});
