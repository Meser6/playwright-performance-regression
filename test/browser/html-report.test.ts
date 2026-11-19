// The HTML report in real Chromium (11, chapter 15): network, JavaScript off, XSS, sorting and
// filters, download, print, dark theme, 360 px, accessibility (axe-core) and the large report.
// The page is served from a routed origin, so every request the page makes is seen.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium, expect as pw } from '@playwright/test';
import type { Browser, BrowserContextOptions, Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { RunReport } from '../../src/core/types/index.ts';
import { renderHtmlReport, toHtmlReportData } from '../../src/html/index.ts';
import { defaultOrder } from '../../src/html/render.ts';
import { fullRun, largeReport, markupCase } from '../unit/html/fixtures.ts';

const URL = 'http://report.test/report.html';
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser.close();
});

interface Opened {
  page: Page;
  requests: string[];
  console: string[];
  dialogs: string[];
}

async function open(
  report: RunReport,
  options: BrowserContextOptions = {},
  page = renderHtmlReport(report),
): Promise<Opened> {
  const context = await browser.newContext({ acceptDownloads: true, ...options });
  const requests: string[] = [];
  await context.route('**/*', async (route) => {
    requests.push(route.request().url());
    if (route.request().url() === URL) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: page });
    } else {
      await route.abort();
    }
  });
  const p = await context.newPage();
  const consoleMessages: string[] = [];
  const dialogs: string[] = [];
  p.on('console', (m) => consoleMessages.push(`${m.type()}: ${m.text()}`));
  p.on('pageerror', (e) => consoleMessages.push(`pageerror: ${e.message}`));
  p.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await p.goto(URL);
  return { page: p, requests, console: consoleMessages, dialogs };
}

async function rowKeys(page: Page, table: string): Promise<string[]> {
  return page
    .locator(`#${table} > tbody:visible`)
    .evaluateAll((bodies) => bodies.map((b) => b.getAttribute('data-key') ?? ''));
}

async function openAllDetails(page: Page): Promise<void> {
  await page.evaluate(
    'for (const d of document.querySelectorAll("details")) d.setAttribute("open", "")',
  );
}

describe('HTML report in Chromium', { timeout: 60_000 }, () => {
  test('11-AC-01 the page makes no request besides the file itself', async () => {
    const { page, requests, console } = await open(markupCase());
    await openAllDetails(page);
    await page.getByRole('button', { name: /Download JSON/u }).click();
    await page.getByRole('button', { name: 'Max' }).first().click();
    await page.waitForTimeout(200);
    expect(requests).toEqual([URL]);
    expect(console).toEqual([]);
    await page.context().close();
  });

  test('11-AC-06 markup in keys and titles is text, no script runs, no CSP violation; javascript: build URL is text', async () => {
    const { page, console, dialogs } = await open(markupCase());
    await openAllDetails(page);
    await pw(
      page.locator('#endpoints-table th.key', { hasText: 'GET /api/<img src=x onerror=alert(1)>' }),
    ).toHaveCount(1);
    await pw(page.getByText('</script><script>alert(1)</script>').first()).toBeVisible();
    await pw(page.locator('main img')).toHaveCount(0);
    await pw(page.locator('script')).toHaveCount(2);
    await pw(page.getByText('javascript:alert(1)')).toBeVisible();
    await pw(page.locator('a[href^="javascript"]')).toHaveCount(0);
    await page.waitForTimeout(100);
    expect(dialogs).toEqual([]);
    expect(console.filter((m) => /Content Security Policy|pageerror/u.test(m))).toEqual([]);
    await page.context().close();

    const report = fullRun();
    report.ci = {
      provider: 'github',
      commit: 'abc',
      branch: 'main',
      buildUrl: 'https://ci.example/1',
    };
    const https = await open(report);
    const link = https.page.getByRole('link', { name: 'https://ci.example/1' });
    await pw(link).toHaveAttribute('href', 'https://ci.example/1');
    await pw(link).toHaveAttribute('rel', 'noopener noreferrer');
    await https.page.context().close();
  });

  test('11-AC-07 without JavaScript: verdict, counters, both tables in the default order and key details', async () => {
    const report = markupCase();
    const { page } = await open(report, { javaScriptEnabled: false });
    await pw(page.getByRole('heading', { name: 'Verdict' })).toBeVisible();
    await pw(page.locator('.card .status')).toHaveText(['failed', 'failed', 'none']);
    await pw(page.getByRole('table', { name: 'Keys per kind' })).toBeVisible();
    const data = toHtmlReportData(report);
    expect(await rowKeys(page, 'endpoints-table')).toEqual(defaultOrder(data.endpoints, 'p95'));
    expect(await rowKeys(page, 'custom-table')).toEqual(defaultOrder(data.custom, 'p95'));
    const first = page.locator('#endpoints-table > tbody').first();
    await first.locator('summary').click();
    await pw(first.getByRole('table', { name: 'Checks' })).toBeVisible();
    await pw(first.locator('svg.bar')).toBeVisible();
    // Filters and the download button need JavaScript.
    await pw(page.locator('.filters').first()).toBeHidden();
    await pw(page.getByRole('button', { name: /Download JSON/u })).toBeHidden();
    await page.context().close();
  });

  test('11-REQ-12 sorting by a column header and reversing it with a second click', async () => {
    const report = markupCase();
    const { page } = await open(report);
    const header = page.locator('#endpoints-table th[data-sort="max"]');
    const max = (key: string) => report.endpoints[key]?.stats?.max ?? -1;

    await header.getByRole('button').click();
    await pw(header).toHaveAttribute('aria-sort', 'descending');
    let keys = await rowKeys(page, 'endpoints-table');
    expect(keys.map(max)).toEqual([...keys.map(max)].sort((a, b) => b - a));

    await header.getByRole('button').click();
    await pw(header).toHaveAttribute('aria-sort', 'ascending');
    keys = await rowKeys(page, 'endpoints-table');
    expect(keys.map(max)).toEqual([...keys.map(max)].sort((a, b) => a - b));

    const keyHeader = page.locator('#endpoints-table th[data-sort="key"]');
    await keyHeader.getByRole('button').click();
    await pw(keyHeader).toHaveAttribute('aria-sort', 'ascending');
    await pw(header).not.toHaveAttribute('aria-sort', /.*/u);
    keys = await rowKeys(page, 'endpoints-table');
    expect(keys).toEqual([...keys].sort());
    // Each key keeps its details row.
    const body = page.locator('#endpoints-table > tbody').first();
    await pw(body.locator(':scope > tr')).toHaveCount(2);
    await page.context().close();
  });

  test('11-REQ-13 filters: key substring, only violations, hide not evaluated; showing X of Y', async () => {
    const report = markupCase();
    const { page } = await open(report);
    const filters = page.locator('[data-filters-for="endpoints-table"]');
    const count = filters.getByRole('status');
    const total = Object.keys(report.endpoints).length;
    await pw(count).toHaveText(`showing ${total} of ${total}`);

    await filters.getByLabel('Filter keys').fill('API/USERS');
    expect((await rowKeys(page, 'endpoints-table')).sort()).toEqual([
      'GET /api/users',
      'GET /api/users/:id',
    ]);
    await pw(count).toHaveText(`showing 2 of ${total}`);
    await filters.getByLabel('Filter keys').fill('');

    await filters.getByLabel('Only violations').check();
    const violations = Object.entries(report.endpoints).filter(
      ([, a]) => a.evaluation.result === 'fail',
    );
    await pw(count).toHaveText(`showing ${violations.length} of ${total}`);
    await filters.getByLabel('Only violations').uncheck();

    await filters.getByLabel('Hide not evaluated').check();
    expect(await rowKeys(page, 'endpoints-table')).not.toContain('GET /api/rare');
    await pw(count).toHaveText(`showing ${total - 1} of ${total}`);
    await page.context().close();
  });

  test('11-REQ-07 Download JSON saves the embedded data as report-data.json', async () => {
    const report = fullRun();
    const { page } = await open(report);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download JSON (aggregates, without raw samples)' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('report-data.json');
    const path = await download.path();
    const saved = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    expect(saved).toEqual(JSON.parse(JSON.stringify(toHtmlReportData(report))));
    expect(readFileSync(path, 'utf8')).not.toContain('"durations"');
    await page.context().close();
  });

  test('11-REQ-17 print: light theme, no filters or buttons, details of violations expanded', async () => {
    const { page } = await open(markupCase(), { colorScheme: 'dark' });
    await page.emulateMedia({ media: 'print' });
    await pw(page.locator('.filters').first()).toBeHidden();
    await pw(page.getByRole('button', { name: /Download JSON/u })).toBeHidden();
    const violation = page.locator('#endpoints-table > tbody[data-group="0"]').first();
    await pw(violation.getByRole('table', { name: 'Checks' })).toBeVisible();
    const passing = page.locator('#endpoints-table > tbody[data-group="2"]').first();
    await pw(passing.getByRole('table', { name: 'Checks' })).toBeHidden();
    const background = await page.evaluate(
      'getComputedStyle(document.documentElement).backgroundColor',
    );
    expect(background).toBe('rgb(255, 255, 255)');
    await page.context().close();
  });

  test('11-REQ-15 dark theme follows prefers-color-scheme', async () => {
    const { page } = await open(fullRun(), { colorScheme: 'dark' });
    const background = await page.evaluate(
      'getComputedStyle(document.documentElement).backgroundColor',
    );
    expect(background).toBe('rgb(13, 17, 23)');
    await page.context().close();
  });

  test('11-REQ-18 at 360 px the tables scroll inside their container, the page does not', async () => {
    const { page } = await open(markupCase(), { viewport: { width: 360, height: 800 } });
    await openAllDetails(page);
    const width = await page.evaluate('document.documentElement.scrollWidth');
    expect(width).toBeLessThanOrEqual(360);
    const scroll = await page
      .locator('#endpoints-table')
      .evaluate((t) => [t.parentElement?.scrollWidth ?? 0, t.parentElement?.clientWidth ?? 0]);
    expect(scroll[0]).toBeGreaterThan(scroll[1] ?? 0);
    await page.context().close();
  });

  test('11-AC-08 axe-core finds no WCAG A or AA violations in the light and the dark theme', async () => {
    for (const colorScheme of ['light', 'dark'] as const) {
      for (const report of [markupCase(), fullRun()]) {
        const { page } = await open(report, { colorScheme });
        await openAllDetails(page);
        await page.evaluate(AXE);
        const violations = (await page.evaluate(
          `axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
            .then((r) => r.violations.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')))`,
        )) as string[];
        expect(violations, colorScheme).toEqual([]);
        await page.context().close();
      }
    }
  });

  // The time limits of 11-AC-05 are checked in the isolated performance suite
  // (test/perf/html.test.ts, 12-PERF-03, 12-D-05): on shared CI runners that run the integration
  // tests in parallel a single timing measures the runner more than the page.
  test('11-AC-05 a 500-key report loads and every sort reorders all 500 rows', async () => {
    const report = largeReport(500, 5000);
    const html = renderHtmlReport(report);
    const context = await browser.newContext();
    await context.route('**/*', (route) =>
      route.request().url() === URL
        ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
        : route.abort(),
    );
    const page = await context.newPage();
    await page.goto(URL, { waitUntil: 'load' });
    await pw(page.locator('#endpoints-table > tbody').first()).toBeVisible();
    expect(await page.locator('#endpoints-table > tbody').count()).toBe(500);
    const keysAfterClick = (column: string) =>
      page.evaluate(
        `(() => { document.querySelector('#endpoints-table th[data-sort="${column}"] button').click(); return [...document.querySelectorAll('#endpoints-table > tbody')].map((t) => t.getAttribute('data-key')); })()`,
      ) as Promise<string[]>;
    // Keys are unique, so sorting by key gives one exact order in each direction.
    const first = await keysAfterClick('key');
    const second = await keysAfterClick('key');
    const ascending = [...first].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    expect(first.length).toBe(500);
    expect([first, second]).toContainEqual(ascending);
    expect([first, second]).toContainEqual([...ascending].reverse());
    for (const column of ['max', 'percentile']) {
      expect((await keysAfterClick(column)).length, column).toBe(500);
    }
    await context.close();
  });
});
