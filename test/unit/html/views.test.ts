// Views of the redesigned HTML report (11, chapter 6): banner, KPI tiles, rankings, headroom,
// histogram, TTFB split, hints, Tests tab, waterfall, migrated reports and the size budget.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildOutcome } from '../../../src/core/evaluate/index.ts';
import type { Hint, RunReport } from '../../../src/core/types/index.ts';
import { histogramX, waterfallSvg } from '../../../src/html/charts.ts';
import { toHtmlReportData, stableJson } from '../../../src/html/data.ts';
import { escapeHtml } from '../../../src/html/escape.ts';
import { formatMs, formatPercent, usageText } from '../../../src/html/format.ts';
import { hintText } from '../../../src/html/hints.ts';
import { renderHtmlReport } from '../../../src/html/index.ts';
import { banner } from '../../../src/html/render.ts';
import { SCRIPT, STYLES } from '../../../src/html/generated/assets.ts';
import { GOLDEN_DIR } from '../../contract/golden.ts';
import {
  HTML_PAGE,
  fullRun,
  largeReport,
  markupCase,
  migratedCase,
  readCase,
  referenceReport,
  stepsRun,
} from './fixtures.ts';

const PATHS = { reportJson: null, reportHtml: null, thresholds: [], thresholdsDiff: null };

function page(report: RunReport): string {
  return renderHtmlReport(report);
}

/** Text of the first element matching a pattern, without tags. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function section(html: string, id: string): string {
  const start = html.indexOf(`aria-labelledby="${id}"`);
  if (start === -1) return '';
  return html.slice(start, html.indexOf('</section>', start));
}

function noThresholds(): RunReport {
  return readCase(join(HTML_PAGE, 'no-thresholds-files.json')).input;
}

describe('verdict banner and KPI tiles (11-REQ-27, 11-REQ-28)', () => {
  test('11-AC-12 banner status and sentence for each case agree with the exit code', () => {
    const cases: [string, RunReport, string, string][] = [];
    const error = fullRun();
    error.toolErrors = [
      { code: 'THRESHOLDS_FILE_INVALID', message: 'bad file', hint: 'fix it' },
      { code: 'OTHER', message: 'x', hint: 'y' },
    ];
    cases.push([
      'tool errors',
      error,
      'ERROR',
      'The tool reported 2 errors: THRESHOLDS_FILE_INVALID — bad file',
    ]);
    cases.push(['blocking', fullRun(), 'FAILED', '1 blocking violation in 1 key: the run fails.']);
    const warned = fullRun();
    warned.evaluation.status = 'warned';
    cases.push(['non-blocking', warned, 'PASSED WITH WARNINGS', '1 violation, none blocking.']);
    const warning = noThresholds();
    warning.warnings = [{ code: 'TESTS_NOT_INSTRUMENTED', message: 'm', hint: 'h' }];
    cases.push(['warning', warning, 'PASSED WITH WARNINGS', 'No violations; 1 warning to review.']);
    const failedTests = noThresholds();
    failedTests.tests = { ...failedTests.tests, status: 'failed', unexpected: 2 };
    cases.push([
      'failed tests',
      failedTests,
      'PASSED WITH WARNINGS',
      '2 test executions failed; results may be incomplete.',
    ]);
    const thresholdsMode = fullRun();
    thresholdsMode.mode = 'thresholds';
    thresholdsMode.evaluation.gateEnabled = false;
    cases.push([
      'thresholds mode',
      thresholdsMode,
      'PASSED WITH WARNINGS',
      'Gate off (thresholds mode): 1 violation would fail a test run.',
    ]);
    cases.push([
      'nothing',
      noThresholds(),
      'PASSED',
      'All 2 evaluated keys are within their limits.',
    ]);
    const exitOf = { ERROR: 3, FAILED: 2, 'PASSED WITH WARNINGS': 0, PASSED: 0 } as const;
    for (const [name, report, status, sentence] of cases) {
      const b = banner(report);
      expect({ status: b.status, sentence: b.sentence }, name).toEqual({ status, sentence });
      expect(buildOutcome(report, PATHS).exitCode, name).toBe(exitOf[b.status]);
      expect(b.exitCode, name).toBe(exitOf[b.status]);
      const html = page(report);
      expect(html, name).toContain(`<h1 class="status" id="vh">${status}`);
      expect(html, name).toContain(`<p class="summary">${escapeHtml(sentence)}<span class="sub">`);
      expect(html, name).toContain(`exit code ${String(exitOf[b.status])}</span>`);
      expect(html.includes('>gate off<'), name).toBe(!report.evaluation.gateEnabled);
    }
    // Default thresholds only: an info box with the command under the sentence (11, chapter 12).
    expect(banner(noThresholds()).defaultsOnly).toBe(true);
    expect(page(noThresholds())).toContain(
      'Evaluated with default thresholds only; run your test command with <code>PW_PERF_MODE=thresholds</code> to create thresholds files.',
    );
    expect(page(fullRun())).not.toContain('PW_PERF_MODE=thresholds</code>');
    const none = noThresholds();
    for (const agg of Object.values(none.endpoints)) agg.evaluation.result = 'not-evaluated';
    none.evaluation.counts.api.fromDefaults = 0;
    expect(banner(none).sentence).toBe(
      'No key was evaluated (too few samples or no applicable rules).',
    );
  });

  test('11-AC-13 KPI tiles equal the reference computation, with the passes of the run', () => {
    const report = fullRun();
    report.runConditions.projects = [
      { ...(report.runConditions.projects[0] as RunReport['runConditions']['projects'][number]) },
      { name: 'b', role: 'measured', browserName: 'chromium', repeatEach: 3, retries: 0 },
      { name: 'setup', role: 'dependency', browserName: 'chromium', repeatEach: 1, retries: 0 },
    ];
    report.finishedAt = '2026-11-18T11:02:03.000Z';
    report.passes = { planned: 5, completed: 4, failed: [3] };
    const html = page(report);
    const fields = (h: string) =>
      [
        ...h.matchAll(
          /<div class="kpi[^"]*"><dt>(.*?)<\/dt><dd class="kv">(.*?)<\/dd>(?:<dd class="viz">.*?<\/dd>)?<dd class="ks">(.*?)<\/dd><\/div>/gu,
        ),
      ].map((m) => [m[1], text(m[2] ?? ''), m[3]]);
    const endpoints = Object.values(report.endpoints);
    const requests = endpoints.reduce((n, a) => n + a.count, 0);
    const errors = endpoints.reduce((n, a) => n + a.errorCount, 0);
    const api = report.evaluation.counts.api;
    expect(fields(html)).toEqual([
      [
        'Endpoints',
        String(endpoints.length),
        `${api.fromFile + api.fromDefaults} evaluated · ${api.tooFewSamples} too few`,
      ],
      ['Tests', '3', '0 failed · 0 flaky · 0 skipped'],
      ['Violations', '1', '1 blocking · 1 muted'],
      ['Error rate', formatPercent(errors / requests), `${errors} of ${requests} requests`],
      ['Duration', '1 h 02 min', '10:00 → 11:02 UTC'],
      ['Passes', '4 of 5', '2 measured projects'],
    ]);
    expect(formatPercent(errors / requests)).toBe('35.3%');
    // A failed pass is a muted pip; the violations field is red with a split bar.
    expect(html).toContain(
      '<span class="pips" aria-hidden="true"><span></span><span></span><span class="off"></span><span></span><span></span></span>',
    );
    expect(html).toMatch(
      /<div class="kpi bad"><dt>Violations<\/dt><dd class="kv">1<\/dd><dd class="viz"><span class="vsplit" aria-hidden="true"><span class="s-bad w-\d+"><\/span>/u,
    );
    // Steps replace Tests when the report has step keys (11-REQ-28).
    expect(fields(page(stepsRun())).map((f) => f[0])).toEqual([
      'Endpoints',
      'Steps',
      'Violations',
      'Error rate',
      'Duration',
      'Passes',
    ]);
    const empty = page(readCase(join(GOLDEN_DIR, 'run-report', 'valid', 'empty-run.json')).input);
    expect(empty).toContain('<dt>Error rate</dt><dd class="kv">—</dd>');
  });
});

describe('Overview: rankings and headroom (11-REQ-29 – 11-REQ-31)', () => {
  /** Endpoint keys with ties in every ranking. */
  function rankingReport(): RunReport {
    const report = fullRun();
    const api = report.endpoints['GET /api/tickets/:id'] as RunReport['endpoints'][string];
    report.endpoints['GET /api/b'] = structuredClone(api);
    report.endpoints['GET /api/a'] = structuredClone(api);
    const passing = structuredClone(api);
    passing.evaluation.muted = null;
    passing.evaluation.checks = passing.evaluation.checks.map((c) => ({ ...c, usage: 0.95 }));
    report.endpoints['GET /api/near'] = passing;
    report.endpoints['GET /api/near-2'] = structuredClone(passing);
    return report;
  }

  function ranking(html: string, id: string): [string, boolean][] {
    const list =
      new RegExp(`<ol class="rank" data-rank="${id}">(.*?)</ol>`, 'su').exec(html)?.[1] ?? '';
    return [
      ...list.matchAll(/<li data-k="(\w+)"( hidden)?><a class="kl" href="#[^"]+">(.*?)<\/a>/gu),
    ].map((m) => [`${m[1] ?? ''}:${text(m[3] ?? '')}`, m[2] !== undefined]);
  }

  test('11-AC-19 rankings: order and ties equal the reference computation; no error-free keys in the error ranking', () => {
    const report = rankingReport();
    const html = page(report);
    const data = toHtmlReportData(report);
    const all = [...Object.entries(data.endpoints).map(([key, a]) => ({ kind: 'api', key, a }))];
    const tie = (x: (typeof all)[number], y: (typeof all)[number]) =>
      (x.kind === y.kind ? 0 : x.kind === 'api' ? -1 : 1) ||
      (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
    const name = (e: (typeof all)[number]) => `${e.kind}:${e.key}`;
    const slowest = all
      .filter((e) => e.a.stats !== null)
      .sort(
        (x, y) =>
          (y.a.stats?.percentiles['p95'] ?? 0) - (x.a.stats?.percentiles['p95'] ?? 0) || tie(x, y),
      );
    expect(ranking(html, 'slowest').map((r) => r[0])).toEqual(slowest.map(name));
    const called = [...all].sort((x, y) => y.a.count - x.a.count || tie(x, y));
    expect(ranking(html, 'called').map((r) => r[0])).toEqual(called.map(name));
    const errors = all
      .filter((e) => e.a.errorCount > 0)
      .sort(
        (x, y) =>
          y.a.errorCount / y.a.count - x.a.errorCount / x.a.count ||
          y.a.errorCount - x.a.errorCount ||
          tie(x, y),
      );
    expect(ranking(html, 'errors').map((r) => r[0])).toEqual(errors.map(name));
    expect(errors.every((e) => e.a.errorCount > 0)).toBe(true);
  });

  test('11-AC-19 a ranking holds the first 10 of every kind; entries after the first 10 are hidden', () => {
    const report = largeReport(15, 10);
    const rows = ranking(page(report), 'called');
    expect(rows.filter(([k]) => k.startsWith('api:'))).toHaveLength(10);
    expect(rows.filter(([, hidden]) => !hidden)).toHaveLength(10);
  });

  test('11-AC-18 Closest to limit lists only passing keys, by headroom descending, ties by kind and key', () => {
    const report = rankingReport();
    const html = page(report);
    const rows = ranking(html, 'closest').map((r) => r[0]);
    expect(rows).toEqual([
      'api:GET /api/near',
      'api:GET /api/near-2',
      'api:GET /api/a',
      'api:GET /api/b',
      'api:GET /api/tickets/:id',
    ]);
    expect(html).toMatch(
      /\/api\/near<\/span><\/a><span class="tb warn"><span class="w-100"><\/span><\/span><span class="v">median <b>95%<\/b><\/span>/u,
    );
    expect(page(migratedCase())).not.toContain('data-rank="closest"');
  });

  test('11-AC-18 headroom text: % of limit, +X% over, over (limit 0), >999%', () => {
    expect(usageText(0.87, false)).toBe('87%');
    expect(usageText(0.87, false, true)).toBe('87% of limit');
    expect(usageText(0.29, false)).toBe('29%');
    expect(usageText(1.35, true)).toBe('+35% over');
    expect(usageText(1, true)).toBe('+1% over');
    expect(usageText(null, true)).toBe('over (limit 0)');
    expect(usageText(10, true)).toBe('>999%');
    expect(usageText(60, true, true)).toBe('>999% of limit');
    const html = page(fullRun());
    expect(html).toContain(
      '<label class="hr"><meter max="1.25" low="0.9" high="1" optimum="0" value="1.25"></meter><b class="ov">&gt;999%</b></label>',
    );
  });

  test('11-REQ-29 violations list: up to 10 failed keys with pill, kind, headroom and first hint; link to all', () => {
    const html = page(fullRun());
    const list = section(html, 'viol-h');
    expect(list.replace(/<[^>]+>/gu, '|').replace(/\|+/gu, '|')).toContain(
      '|fail · blocking|endpoint|default|POST| |/api/orders|error rate |60.0%| · limit 1.0%|&gt;999%|Error rate 100.0% is above the limit of 1.0%, mostly FAILED (5 of 5 errors).|',
    );
    expect(list).toContain('<article class="card vio">');
    expect(list).toContain(
      '<a class="more" href="#tab-endpoints" data-show-violations="">All 1 violation →</a>',
    );
    expect(page(noThresholds())).not.toContain('id="viol-h"');
  });
});

describe('charts (11-REQ-32, 11-REQ-33)', () => {
  test('11-AC-20 histogram: one step per bin, tallest bar full height, markers inside their bins, label', () => {
    const report = fullRun();
    const agg = report.endpoints['GET /api/tickets/:id'] as RunReport['endpoints'][string];
    const html = page(report);
    const svg = /<svg class="hist ch"[^>]*>.*?<\/svg>/su.exec(html)?.[0] ?? '';
    // The limit is beyond the last edge, so every bin is within it: one neutral outline.
    expect(svg).not.toContain('bars-hi');
    const d = /<path class="bars" d="([^"]+)"/u.exec(svg)?.[1] ?? '';
    const histogram = agg.histogram;
    if (histogram === null) throw new Error('fixture');
    expect(d.match(/h/gu)?.length).toBe(histogram.counts.length);
    // The tallest bar reaches the top of the bar area (72 px above the base).
    const base = Number(/^M8 ([\d.]+)/u.exec(d)?.[1]);
    const tops = [...d.matchAll(/V([\d.]+)/gu)].map((m) => Number(m[1]));
    expect(base - Math.min(...tops)).toBeCloseTo(72, 1);
    // Markers lie in the bins given by the edges.
    const { edges } = histogram;
    const width = 624 / histogram.counts.length;
    for (const value of [agg.stats?.percentiles['p50'] ?? 0, agg.stats?.percentiles['p99'] ?? 0]) {
      const { x } = histogramX(edges, value);
      const bin = edges.findIndex((e, i) => e <= value && value < (edges[i + 1] ?? Infinity));
      expect(x).toBeGreaterThanOrEqual(8 + bin * width - 0.1);
      expect(x).toBeLessThanOrEqual(8 + (bin + 1) * width + 0.1);
    }
    // The limit (1400 ms) is beyond the last edge: drawn at the edge, with an arrow.
    expect(svg).toContain('<path class="hl" d="M632 ');
    expect(svg).toContain('>limit 1400 ms →</text>');
    const label = /aria-label="([^"]*)"/u.exec(svg)?.[1] ?? '';
    expect(label).toContain(
      `Histogram of ${histogram.counts.reduce((a, b) => a + b, 0)} durations`,
    );
    expect(label).toContain('p50 180 ms, p95 250 ms, p99 250 ms, limit 1400 ms');
    expect(svg).toMatch(/role="img"/u);
    // A limit below the first edge is drawn at the left edge.
    expect(histogramX([100, 200], 50)).toEqual({ x: 8, side: 'left' });
    // A migrated report shows the percentile bar (11-REQ-11).
    expect(page(migratedCase())).toContain('<svg class="bar"');
    // A limit inside the range: bins whose lower edge is at or above it are red (bars-hi).
    const inside = fullRun();
    const key = inside.endpoints['GET /api/tickets/:id'] as RunReport['endpoints'][string];
    const lower = histogram.edges[2] ?? 0;
    key.evaluation.limits.percentile = lower;
    const svg2 = /<svg class="hist ch"[^>]*>.*?<\/svg>/su.exec(page(inside))?.[0] ?? '';
    const neutral = /<path class="bars" d="([^"]+)"/u.exec(svg2)?.[1] ?? '';
    const high = /<path class="bars-hi" d="([^"]+)"/u.exec(svg2)?.[1] ?? '';
    expect(neutral.match(/h/gu)?.length).toBe(2);
    expect((high.match(/h/gu)?.length ?? 0) + 2).toBe(histogram.counts.length);
    expect(high.startsWith(`M${String(Math.round((8 + 2 * width) * 10) / 10)} `)).toBe(true);
  });

  test('11-AC-20 a sampled key says so; equal durations give one bin; no stats give a message', () => {
    const report = fullRun();
    const agg = report.endpoints['GET /api/tickets/:id'] as RunReport['endpoints'][string];
    agg.samples.sampled = true;
    agg.histogram = { edges: [195.7, 205.4], counts: [agg.samples.durations.length] };
    const html = page(report);
    expect(html).toMatch(/aria-label="Histogram of \d+ durations[^"]*; uniform sample of \d+"/u);
    expect(page(fullRun())).toContain('<p>No successful timed samples.</p>');
  });

  test('11-AC-21 TTFB split only for endpoints with otherP50, segments proportional to TTFB p50 and otherP50', () => {
    const report = fullRun();
    const ttfb = report.endpoints['GET /api/tickets/:id']?.ttfb;
    if (ttfb == null || ttfb.otherP50 === null) throw new Error('fixture');
    const html = page(report);
    const svgs = [...html.matchAll(/<svg class="split"[^>]*>(.*?)<\/svg>/gsu)];
    expect(svgs).toHaveLength(1);
    const widths = [...(svgs[0]?.[1] ?? '').matchAll(/width="([\d.]+)"/gu)].map((m) =>
      Number(m[1]),
    );
    expect(widths[0]).toBeCloseTo((640 * ttfb.p50) / (ttfb.p50 + ttfb.otherP50), 1);
    expect((widths[0] ?? 0) + (widths[1] ?? 0)).toBeCloseTo(640, 1);
    expect(html).toContain(
      `Medians of each part: their sum (${formatMs(ttfb.p50 + ttfb.otherP50)}) can differ from p50 of the duration (180 ms).`,
    );
    expect(page(migratedCase())).not.toContain('class="split"');
  });
});

describe('hints (11-REQ-34)', () => {
  interface Case {
    name: string;
    input: { evaluation: { muted: Parameters<typeof hintText>[2] } };
    expected: Hint[];
    texts: string[];
  }
  const cases = JSON.parse(
    readFileSync(join(GOLDEN_DIR, 'report', 'hints', 'cases.json'), 'utf8'),
  ) as Case[];

  test.each(cases.map((c) => [c.name, c] as const))('11-AC-22 text: %s', (_, c) => {
    expect(c.expected.map((h) => hintText(h, 'p95', c.input.evaluation.muted))).toEqual(c.texts);
  });

  test('11-AC-22 hints appear in the key details, escaped; none in a migrated report', () => {
    const html = page(fullRun());
    expect(html).toContain(
      '<ul class="hints"><li><svg class="i" aria-hidden="true"><use href="#i-bulb"/></svg>Error rate 100.0% is above the limit of 1.0%, mostly FAILED (5 of 5 errors).</li><li><svg class="i" aria-hidden="true"><use href="#i-bulb"/></svg>100.0% of the samples come from failed tests: the results may be distorted.</li></ul>',
    );
    expect(page(migratedCase())).not.toContain('class="hints"');
    const markup = markupCase();
    const agg = Object.values(markup.endpoints)[0] as RunReport['endpoints'][string];
    agg.hints = [
      {
        code: 'HINT_ERRORS_DOMINANT',
        params: { rate: 0.5, limit: 0.1, label: '<b>x</b>', count: 1, errors: 2 },
      },
    ];
    expect(page(markup)).toContain('mostly &lt;b&gt;x&lt;/b&gt; (1 of 2 errors)');
  });
});

describe('Tests tab and waterfall (11-REQ-35, 11-REQ-36)', () => {
  test('11-AC-23 rows and order equal testBreakdown.tests; omitted note; v1 message with the tool version', () => {
    const report = referenceReport(30);
    const breakdown = report.testBreakdown;
    if (breakdown === null) throw new Error('fixture');
    breakdown.omitted = 7;
    const html = page(report);
    const rows = [
      ...html.matchAll(
        /<tr data-i="(\d+)"[^>]*><th scope="row" class="tc"><span class="tn">(.*?)<\/span>/gu,
      ),
    ].map((m) => [Number(m[1]), text(m[2] ?? '')]);
    expect(rows).toEqual(breakdown.tests.map((t, i) => [i, t.title]));
    expect(html).toContain('and 7 more tests with a smaller total wait (not stored in the report)');
    const first = breakdown.tests[0];
    expect(html).toContain(`<a class="kl" href="#key-api-`);
    // Total wait bars are relative to the largest total wait, with width classes (11-REQ-55).
    expect(html).toContain('<span class="tb neu tw"><span class="w-100"></span></span>');
    expect(first?.violatedKeyCount).toBe(2);
    const migrated = page(migratedCase());
    expect(migrated).toContain(
      'Per-test data is not available: this report was created by playwright-performance-regression v0.1.0 (report format v1). Re-run the tests with a newer version.',
    );
    expect(
      page(readCase(join(GOLDEN_DIR, 'run-report', 'valid', 'empty-run.json')).input),
    ).toContain('No test made backend requests in measured projects.');
  });

  test('11-AC-24 five waterfalls in report order; 200 rows and a note for omitted; diamonds for requests without a time', () => {
    const report = referenceReport(30);
    const waterfalls = report.testBreakdown?.waterfalls ?? [];
    const html = page(report);
    const charts = [
      ...html.matchAll(
        /<figure class="card wfb"><figcaption class="wf-h"><div><h4>(.*?)<\/h4>.*?<\/figure>/gsu,
      ),
    ];
    expect(charts.map((m) => text(m[1] ?? ''))).toEqual(waterfalls.map((w) => w.test.title));
    const first = charts[0]?.[0] ?? '';
    expect(first.match(/<g class="w\w">/gu)?.length).toBe(200);
    expect(first).toContain('<p class="tfoot">and 30 more requests not shown</p>');
    expect(first).toContain('<dt>Span</dt><dd>45.7 s</dd>');
    const w = waterfalls[0];
    if (w === undefined) throw new Error('fixture');
    const failed = w.requests[0];
    expect(failed?.duration).toBeNull();
    expect(first).toContain(
      `<g class="we"><title>${escapeHtml(failed?.key ?? '')} · FAILED · start +0.0 ms · no duration</title>`,
    );
    expect(first).toContain(
      '<path d="M350 28l6 6-6 6-6-6z"/><text class="d" x="360" y="38">FAILED</text>',
    );
    const second = w.requests[1];
    expect(first).toContain(
      `<title>${escapeHtml(second?.key ?? '')} · 200 · start +220 ms · 124 ms</title>`,
    );
    // The axis ends at spanMs, with + labels at 0, ¼, ½, ¾ and the end.
    expect(first).toContain('x="880" y="12">+45.7 s</text>');
    // The time after the bar, with the status when it is not 2xx/3xx.
    expect(first).toMatch(
      /height="12" rx="2"\/><text class="d(?: ae)?" x="[\d.]+" y="58">124 ms<\/text>/u,
    );
    expect([...first.matchAll(/<text class="wt[^"]*" x="[\d.]+" y="12">\+/gu)]).toHaveLength(5);
    const svg = waterfallSvg(w, 't').text;
    expect(svg).toMatch(
      /^<svg class="wf ch" viewBox="0 0 960 \d+" role="img" aria-label="Waterfall of 230 requests over 45.7 s; longest request /u,
    );
  });

  test('11-REQ-36 status classes: 5xx, FAILED, PENDING error; 4xx warning; ABORTED muted', async () => {
    const { waterfallClass } = await import('../../../src/html/charts.ts');
    expect(
      ['503', 'FAILED', 'PENDING', '404', 'ABORTED', '200', '304'].map(waterfallClass),
    ).toEqual(['we', 'we', 'we', 'ww', 'wm', 'wn', 'wn']);
  });
});

describe('migrated reports and golden pages (11-REQ-44, 11-AC-28)', () => {
  test('11-AC-29 a report migrated from v1 renders the reduced view', () => {
    const html = page(migratedCase());
    expect(html).toContain('<svg class="bar"');
    expect(html).not.toContain('<meter');
    expect(html).not.toContain('data-rank="closest"');
    expect(html).not.toContain('class="hints"');
    expect(html).toContain('Per-test data is not available');
    expect(html).toContain('Report format v1 (playwright-performance-regression v0.1.0)');
    // Headroom column: — for every key.
    const rows = [
      ...html.matchAll(
        /<tbody data-g[^>]*><tr class="[^"]+"><th scope="row" class="k">.*?<\/th>(?:<td class="es">[a-z]+<\/td>)?<td class="r">.*?<\/td><td class="z">(.*?)<\/td>/gsu,
      ),
    ];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((m) => m[1] === '—')).toBe(true);
  });

  test('11-AC-28 golden pages exist for full-run, empty-run, thresholds mode, no thresholds files and a v1 report', () => {
    for (const name of [
      'full-run',
      'empty-run',
      'thresholds-mode-sparse-config',
      'no-thresholds-files',
      'migrated-v1',
    ]) {
      const html = readFileSync(join(HTML_PAGE, `${name}.html`), 'utf8');
      expect(html.startsWith('<!doctype html>'), name).toBe(true);
    }
  });

  test('11-AC-31 markup in test titles, waterfall titles and keys in hints and rankings is escaped; no style or on* attributes', () => {
    const report = referenceReport(10);
    const evil = '<img src=x onerror=alert(1)>';
    const breakdown = report.testBreakdown;
    if (breakdown === null) throw new Error('fixture');
    (breakdown.tests[0] as (typeof breakdown.tests)[number]).title = evil;
    (breakdown.waterfalls[0] as (typeof breakdown.waterfalls)[number]).test.title = evil;
    const key = Object.keys(report.endpoints)[0] as string;
    const agg = report.endpoints[key] as RunReport['endpoints'][string];
    report.endpoints = Object.fromEntries(
      Object.entries(report.endpoints).filter(([k]) => k !== key),
    );
    report.endpoints[`GET /${evil}`] = agg;
    const waterfall = breakdown.waterfalls[0] as (typeof breakdown.waterfalls)[number];
    waterfall.requests[0] = {
      ...(waterfall.requests[0] as (typeof waterfall.requests)[number]),
      key: `GET /${evil}`,
    };
    const html = page(report);
    const body = html.slice(0, html.indexOf('<script type="application/json"'));
    expect(body).not.toContain('<img');
    expect(body).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(body.replace(/"[^"]*"/gu, '""')).not.toMatch(/<[a-z]+\s[^>]*\s(?:style|on[a-z]+)=/u);
  });
});

describe('size budget (11-REQ-43)', () => {
  const B = (s: string) => Buffer.byteLength(s, 'utf8');
  const max = (xs: number[]) => Math.max(...xs);
  const kB = (n: number) => Math.round(n * 1024);
  // The budget table of 11-REQ-43 (bytes before compression). A change here needs a change of
  // the table in the specification first.
  const BUDGET = {
    total: 10 * 1024 * 1024,
    assets: kB(60),
    keyData: kB(3.2),
    keyRow: kB(0.75),
    keyDetails: kB(6.6),
    histogram: kB(1.1),
    checks: kB(1.8),
    hints: kB(0.55),
    test: kB(2.4),
    waterfallData: kB(25),
    waterfallSvg: kB(60),
    rest: kB(0.1 * 1024),
  };
  const report = referenceReport();
  const html = renderHtmlReport(report);
  const data = toHtmlReportData(report);
  const keys = Object.keys(data.endpoints);
  const all = (pattern: RegExp) => [...html.matchAll(pattern)].map((m) => B(m[0]));

  test('11-AC-25 the reference report is below 10 MB; CSS and JS together below 60 kB', () => {
    expect(keys).toHaveLength(500);
    expect(report.testBreakdown?.tests).toHaveLength(500);
    expect(report.testBreakdown?.waterfalls).toHaveLength(5);
    expect(B(html)).toBeLessThan(BUDGET.total);
    expect(B(STYLES) + B(SCRIPT)).toBeLessThan(BUDGET.assets);
  });

  test('11-AC-25 every element stays within its budget', () => {
    expect(max(keys.map((k) => B(stableJson(data.endpoints[k]))))).toBeLessThanOrEqual(
      BUDGET.keyData,
    );
    const keyRows = all(/<tbody data-g[^>]*><tr class=.*?<\/tr>/gsu);
    expect(keyRows).toHaveLength(keys.length);
    expect(max(keyRows)).toBeLessThanOrEqual(BUDGET.keyRow);
    expect(max(all(/<div class="kd">.*?<\/div><\/details>/gsu))).toBeLessThanOrEqual(
      BUDGET.keyDetails,
    );
    expect(max(all(/<svg class="hist ch".*?<\/svg>/gsu))).toBeLessThanOrEqual(BUDGET.histogram);
    expect(max(all(/<table class="ck">.*?<\/table>/gsu))).toBeLessThanOrEqual(BUDGET.checks);
    expect(max(all(/<ul class="hints">.*?<\/ul>/gsu))).toBeLessThanOrEqual(BUDGET.hints);
    const tests = data.testBreakdown?.tests ?? [];
    const rows = all(/<tr data-i=.*?<\/tr>/gsu);
    expect(tests).toHaveLength(rows.length);
    expect(max(tests.map((t, i) => B(stableJson(t)) + (rows[i] ?? 0)))).toBeLessThanOrEqual(
      BUDGET.test,
    );
    const waterfalls = data.testBreakdown?.waterfalls ?? [];
    expect(max(waterfalls.map((w) => B(stableJson(w))))).toBeLessThanOrEqual(BUDGET.waterfallData);
    expect(max(all(/<svg class="wf ch".*?<\/svg>/gsu))).toBeLessThanOrEqual(BUDGET.waterfallSvg);
  });

  test('11-AC-25 adding one key, test or waterfall grows the page by at most its budget', () => {
    const base = referenceReport();
    const grown = referenceReport();
    const [key, agg] = Object.entries(grown.endpoints)[1] as [
      string,
      RunReport['endpoints'][string],
    ];
    grown.endpoints[`${key}&extra`] = structuredClone(agg);
    const perKey = B(renderHtmlReport(grown)) - B(renderHtmlReport(base));
    expect(perKey).toBeLessThanOrEqual(BUDGET.keyData + BUDGET.keyRow + BUDGET.keyDetails);
    const fewer = referenceReport();
    fewer.testBreakdown?.tests.pop();
    fewer.testBreakdown?.waterfalls.pop();
    const perTestAndWaterfall = B(renderHtmlReport(base)) - B(renderHtmlReport(fewer));
    expect(perTestAndWaterfall).toBeLessThanOrEqual(
      BUDGET.test + BUDGET.waterfallData + BUDGET.waterfallSvg,
    );
    // Header, banner, tiles, icon sprite, Overview, Warnings and Run & config without the config
    // snapshot.
    const rest =
      B(html) -
      keys.reduce((n, k) => n + B(stableJson(data.endpoints[k])), 0) -
      all(/<tbody data-g.*?<\/details><\/td><\/tr><\/tbody>/gsu).reduce((a, b) => a + b, 0) -
      all(/<tr data-i=.*?<\/tr>/gsu).reduce((a, b) => a + b, 0) -
      B(stableJson(data.testBreakdown)) -
      all(/<figure class="card wfb">.*?<\/figure>/gsu).reduce((a, b) => a + b, 0) -
      B(STYLES) -
      B(SCRIPT) -
      2 * B(stableJson(report.config, '  '));
    expect(rest).toBeLessThanOrEqual(BUDGET.rest);
  });
});

describe('APIRequestContext keys (15-REQ-15)', () => {
  test('15-AC-08 the Endpoints table has a Source column; request keys show a token without the prefix', () => {
    const report = fullRun();
    const [key, agg] = Object.entries(report.endpoints)[0] ?? [];
    if (key === undefined || agg === undefined) throw new Error('no endpoint');
    report.endpoints[`request ${key}`] = { ...agg, ttfb: null };
    const html = page(report);
    expect(html).toContain(
      '<th scope="col" data-sort="source"><button type="button">Source</button></th>',
    );
    expect(html).toContain('<td class="es">request</td>');
    expect(html).toContain('<td class="es">browser</td>');
    expect(html).toContain('<span class="rq">request</span> <b class="m');
    expect(html).toContain('Source: request (worker clock)');
    expect(html).not.toMatch(/<span class="key"[^>]*>request /u);
  });
});
