// The HTML report in real Chromium (11, chapter 15): network, JavaScript off, XSS, tabs, drawer,
// deep links, sorting and filters, download, print, dark theme, 360 px and accessibility
// (axe-core). The page is served from a routed origin, so every request it makes is seen. No
// timing assertions here: the time limits are checked in test/perf/html.test.ts (12-D-05).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium, expect as pw } from '@playwright/test';
import type { Browser, BrowserContextOptions, Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { RunReport } from '../../src/core/types/index.ts';
import { renderHtmlReport, toHtmlReportData } from '../../src/html/index.ts';
import { defaultOrder } from '../../src/html/render.ts';
import { fullRun, largeReport, markupCase, referenceReport } from '../unit/html/fixtures.ts';

const URL = 'http://report.test/report.html';
const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const TABS = ['overview', 'endpoints', 'custom', 'tests', 'warnings', 'run'];

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
  hash = '',
  html = renderHtmlReport(report),
): Promise<Opened> {
  const context = await browser.newContext({ acceptDownloads: true, ...options });
  const requests: string[] = [];
  await context.route('**/*', async (route) => {
    requests.push(route.request().url());
    if (route.request().url() === URL) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
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
  await p.goto(URL + hash);
  return { page: p, requests, console: consoleMessages, dialogs };
}

/** Keys of the visible rows of a key table, in their order. */
async function rowKeys(page: Page, kind: 'api' | 'custom'): Promise<string[]> {
  return page
    .locator(`#table-${kind} > tbody`)
    .evaluateAll((bodies) =>
      bodies
        .filter((b) => !b.hasAttribute('hidden'))
        .map((b) => b.querySelector('.fk')?.textContent ?? ''),
    );
}

async function openAllDetails(page: Page): Promise<void> {
  await page.evaluate(
    'for (const d of document.querySelectorAll("details")) d.setAttribute("open", "")',
  );
}

async function axe(page: Page): Promise<string[]> {
  await page.evaluate(AXE);
  return (await page.evaluate(
    `axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })
      .then((r) => r.violations.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')))`,
  )) as string[];
}

const drawer = (page: Page) => page.locator('#drawer');

describe('HTML report in Chromium', { timeout: 120_000 }, () => {
  test('11-AC-01 the page makes no request besides the file itself', async () => {
    const { page, requests, console } = await open(markupCase());
    await page.getByRole('button', { name: /Download JSON/u }).click();
    await page.getByRole('tab', { name: /Endpoints/u }).click();
    await page.getByRole('button', { name: 'Max' }).first().click();
    await page.locator('#table-api a[href^="#key-"]').first().click();
    await page.waitForTimeout(200);
    expect(requests).toEqual([URL]);
    expect(console).toEqual([]);
    await page.context().close();
  });

  test('11-AC-06 11-AC-31 markup in keys, titles and the address is text: no script, no CSP violation', async () => {
    const report = referenceReport(10);
    const evil = '<img src=x onerror=alert(1)>';
    const breakdown = report.testBreakdown;
    if (breakdown === null) throw new Error('fixture');
    const [key, agg] = Object.entries(report.endpoints)[0] as [
      string,
      RunReport['endpoints'][string],
    ];
    report.endpoints = Object.fromEntries(
      Object.entries(report.endpoints).filter(([k]) => k !== key),
    );
    report.endpoints[`GET /api/${evil}`] = agg;
    const t = breakdown.tests[0] as (typeof breakdown.tests)[number];
    t.title = '</script><script>alert(1)</script>';
    t.topKeys[0] = { ...(t.topKeys[0] as (typeof t.topKeys)[number]), key: `GET /api/${evil}` };
    const w = breakdown.waterfalls[0] as (typeof breakdown.waterfalls)[number];
    w.test.title = evil;
    w.requests[0] = { ...(w.requests[0] as (typeof w.requests)[number]), key: `GET /api/${evil}` };
    for (const r of [markupCase(), report]) {
      for (const hash of ['', '#key=api:%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E', '#tab=tests']) {
        const { page, console, dialogs } = await open(r, {}, hash);
        await openAllDetails(page);
        for (const tab of TABS) {
          const link = page.locator(`[data-tab="${tab}"]`);
          if ((await link.count()) > 0) await link.click();
        }
        await pw(page.locator('main img')).toHaveCount(0);
        await pw(page.locator('script')).toHaveCount(2);
        await page.waitForTimeout(100);
        expect(dialogs).toEqual([]);
        expect(console.filter((m) => /Content Security Policy|pageerror/u.test(m))).toEqual([]);
        await page.context().close();
      }
    }
    const markup = await open(markupCase(), {}, '#tab=endpoints');
    await pw(
      markup.page.locator('#table-api a', { hasText: 'GET /api/<img src=x onerror=alert(1)>' }),
    ).toHaveCount(1);
    await markup.page.getByRole('tab', { name: /Run & config/u }).click();
    await pw(markup.page.getByText('javascript:alert(1)')).toBeVisible();
    await pw(markup.page.locator('a[href^="javascript"]')).toHaveCount(0);
    await markup.page.context().close();

    const https = fullRun();
    https.ci = {
      provider: 'github',
      commit: 'abc',
      branch: 'main',
      buildUrl: 'https://ci.example/1',
    };
    const opened = await open(https, {}, '#tab=run');
    const link = opened.page.getByRole('link', { name: 'https://ci.example/1' });
    await pw(link).toHaveAttribute('href', 'https://ci.example/1');
    await pw(link).toHaveAttribute('rel', 'noopener noreferrer');
    await opened.page.context().close();
  });

  test('11-AC-07 11-AC-15 without JavaScript: all panels in order, anchors, details with histograms, no JS-only controls', async () => {
    const report = fullRun();
    const { page } = await open(report, { javaScriptEnabled: false });
    await pw(page.getByRole('heading', { name: 'FAILED' })).toBeVisible();
    for (const tab of TABS) {
      await pw(page.locator(`#tab-${tab}`)).toBeVisible();
      await pw(page.locator(`.tabs a[href="#tab-${tab}"]`)).toBeVisible();
    }
    await pw(page.locator('.card .status')).toHaveText(['passed', 'failed', 'none']);
    const data = toHtmlReportData(report);
    expect(await rowKeys(page, 'api')).toEqual(defaultOrder(data.endpoints, 'p95'));
    expect(await rowKeys(page, 'custom')).toEqual(defaultOrder(data.custom, 'p95'));
    await pw(page.locator('#table-api details')).toHaveCount(Object.keys(report.endpoints).length);
    const timed = page.locator('#table-api > tbody').nth(1);
    await timed.locator('summary').click();
    await pw(timed.getByRole('table', { name: 'Checks' })).toBeVisible();
    await pw(timed.locator('svg.hist')).toBeVisible();
    await pw(page.locator('#table-tests')).toBeVisible();
    await pw(page.locator('svg.wf')).toBeVisible();
    for (const selector of ['.tools', '#download', '[data-copy]', '#drawer', '[data-kinds]']) {
      await pw(page.locator(selector).first()).toBeHidden();
    }
    await page.context().close();
  });

  test('11-AC-14 tabs: one panel; arrows, Home and End; #tab= links; counts; Custom only with custom keys', async () => {
    const { page } = await open(fullRun());
    const visible = async () =>
      page
        .locator('[data-panel]')
        .evaluateAll((ps) =>
          ps.filter((p) => !p.hasAttribute('hidden')).map((p) => p.getAttribute('data-panel')),
        );
    expect(await visible()).toEqual(['overview']);
    await pw(page.getByRole('tablist')).toBeVisible();
    await pw(page.getByRole('tab', { name: 'Endpoints 2' })).toBeVisible();
    await pw(page.getByRole('tab', { name: 'Warnings 1' })).toBeVisible();
    await page.getByRole('tab', { name: 'Overview' }).focus();
    await page.keyboard.press('ArrowRight');
    expect(await visible()).toEqual(['endpoints']);
    await pw(page.getByRole('tab', { name: /Endpoints/u })).toBeFocused();
    expect(page.url()).toBe(`${URL}#tab=endpoints`);
    await page.keyboard.press('End');
    expect(await visible()).toEqual(['run']);
    await page.keyboard.press('Home');
    expect(await visible()).toEqual(['overview']);
    await page.keyboard.press('ArrowLeft');
    expect(await visible()).toEqual(['run']);
    await pw(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'false');
    await page.context().close();

    const tests = await open(fullRun(), {}, '#tab=tests');
    await pw(tests.page.locator('#tab-tests')).toBeVisible();
    await pw(tests.page.locator('#tab-overview')).toBeHidden();
    await tests.page.context().close();

    const noCustom = fullRun();
    noCustom.custom = {};
    const plain = await open(noCustom);
    await pw(plain.page.locator('[data-tab="custom"]')).toHaveCount(0);
    await pw(plain.page.locator('[data-tab="api-requests"]')).toHaveCount(0);
    await plain.page.context().close();
  });

  test('11-AC-16 drawer: open from table, ranking, violations and Tests; focus, #key= link, Esc, deep links', async () => {
    const report = fullRun();
    const { page } = await open(report);
    // From the violations list in Overview.
    const fromList = page.locator('section[aria-labelledby="viol-h"] a[href^="#key-"]').first();
    await fromList.click();
    await pw(drawer(page)).toBeVisible();
    await pw(page.locator('#drawer-title')).toBeFocused();
    await pw(page.locator('#drawer-title')).toHaveText('POST /api/orders');
    await pw(page.locator('#tab-endpoints')).toBeVisible();
    expect(page.url()).toBe(`${URL}#key=api:${encodeURIComponent('POST /api/orders')}`);
    await pw(drawer(page).getByRole('table', { name: 'Checks' })).toBeVisible();
    await page.keyboard.press('Escape');
    await pw(drawer(page)).toBeHidden();
    await pw(fromList).toBeFocused();
    // The block went back to its row.
    await pw(page.locator('#table-api details .kd')).toHaveCount(2);
    // From a ranking, the table and the Tests tab.
    await page.getByRole('tab', { name: 'Overview' }).click();
    await page.locator('ol[data-rank="called"] a').first().click();
    await pw(page.locator('#drawer-title')).toHaveText('GET /api/tickets/:id');
    await page.getByRole('button', { name: 'Close' }).click();
    // Closing returns to the tab of the link that opened the drawer.
    await pw(page.locator('#tab-overview')).toBeVisible();
    await page.getByRole('tab', { name: /Endpoints/u }).click();
    await page.locator('#table-api a[href^="#key-"]').first().click();
    await pw(page.locator('#drawer-title')).toHaveText('POST /api/orders');
    await page.getByRole('button', { name: 'Next key' }).click();
    await pw(page.locator('#drawer-title')).toHaveText('GET /api/tickets/:id');
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('tab', { name: /Tests/u }).click();
    await page.locator('#table-tests a[href^="#key-"]').first().click();
    await pw(drawer(page)).toBeVisible();
    await pw(page.locator('#tab-endpoints')).toBeVisible();
    await page.context().close();

    // Next key walks only over the visible rows of a filtered table.
    const big = await open(largeReport(30, 10), {}, '#tab=endpoints');
    const tools = big.page.locator('[data-for="table-api"]');
    await tools.getByRole('button', { name: 'pass', exact: true }).click();
    const passing = await rowKeys(big.page, 'api');
    await big.page.locator('#table-api > tbody:visible a[href^="#key-"]').first().click();
    await big.page.getByRole('button', { name: 'Next key' }).click();
    await pw(big.page.locator('#drawer-title')).toHaveText(passing[1] ?? '');
    await big.page.context().close();

    // Deep links when the page opens.
    const custom = await open(fullRun(), {}, '#key=custom:checkout%3Aload-cart');
    await pw(custom.page.locator('#tab-custom')).toBeVisible();
    await pw(custom.page.locator('#drawer-title')).toHaveText('checkout:load-cart');
    await custom.page.context().close();
    const unknown = await open(fullRun(), {}, '#key=api:GET%20%2Fnope');
    await pw(unknown.page.locator('#tab-overview')).toBeVisible();
    await pw(unknown.page.getByRole('status').first()).toHaveText('Key not found in this report');
    await pw(drawer(unknown.page)).toBeHidden();
    await unknown.page.context().close();
    const anchor = await open(fullRun(), {}, '#key-api-1');
    await pw(anchor.page.locator('#drawer-title')).toHaveText('POST /api/orders');
    await anchor.page.context().close();
  });

  test('11-AC-17 filters: result chips are or-ed, groups and text and-ed; counter; reset; ranking kinds', async () => {
    const report = largeReport(40, 10);
    const { page } = await open(report, {}, '#tab=endpoints');
    const tools = page.locator('[data-for="table-api"]');
    const count = tools.getByRole('status');
    const data = toHtmlReportData(report);
    const groupOf = (key: string): number => {
      const ev = data.endpoints[key]?.evaluation;
      if (ev?.result === 'fail') return ev.checks.some((c) => c.blocking) ? 0 : 1;
      return ev?.result === 'pass' ? 2 : 3;
    };
    const keys = Object.keys(data.endpoints);
    await pw(count).toHaveText(`showing ${keys.length} of ${keys.length}`);
    await tools.getByRole('button', { name: 'blocking' }).click();
    await tools.getByRole('button', { name: 'pass', exact: true }).click();
    const either = keys.filter((k) => [0, 2].includes(groupOf(k)));
    expect((await rowKeys(page, 'api')).sort()).toEqual(either.sort());
    await pw(count).toHaveText(`showing ${either.length} of ${keys.length}`);
    await tools.getByRole('button', { name: 'default' }).click();
    const defaults = either.filter(
      (k) => data.endpoints[k]?.evaluation.thresholdSource === 'default',
    );
    expect((await rowKeys(page, 'api')).sort()).toEqual(defaults.sort());
    await tools.getByRole('searchbox').fill('RESOURCE-001');
    const text = defaults.filter((k) => k.toLowerCase().includes('resource-001'));
    expect((await rowKeys(page, 'api')).sort()).toEqual(text.sort());
    await pw(count).toHaveText(`showing ${text.length} of ${keys.length}`);
    await tools.getByRole('button', { name: 'Reset' }).click();
    await pw(count).toHaveText(`showing ${keys.length} of ${keys.length}`);
    // "All N violations" sets the violation chips.
    await page.getByRole('tab', { name: 'Overview' }).click();
    await page.locator('a[data-show-violations]').click();
    await pw(tools.getByRole('button', { name: 'blocking' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await pw(tools.getByRole('button', { name: 'violation' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect((await rowKeys(page, 'api')).sort()).toEqual(keys.filter((k) => groupOf(k) <= 1).sort());
    await page.context().close();

    // Ranking kinds: only custom keys after switching endpoints off.
    const mixed = largeReport(15, 10);
    const cart = fullRun().custom['checkout:load-cart'] as RunReport['custom'][string];
    for (let i = 0; i < 12; i++)
      mixed.custom[`render:${String(i).padStart(2, '0')}`] = structuredClone(cart);
    const ranks = await open(mixed);
    const visibleKinds = () =>
      ranks.page
        .locator('ol[data-rank="called"] li')
        .evaluateAll((items) =>
          items.filter((i) => !i.hasAttribute('hidden')).map((i) => i.getAttribute('data-k')),
        );
    expect(await visibleKinds()).toHaveLength(10);
    await ranks.page.locator('[data-kinds] button[data-k="api"]').click();
    expect(await visibleKinds()).toEqual(new Array(10).fill('custom'));
    await ranks.page.context().close();
  });

  test('11-REQ-12 11-AC-23 sorting key and Tests tables by a header, reversed by a second click', async () => {
    const report = largeReport(20, 10);
    const { page } = await open(report, {}, '#tab=endpoints');
    const header = page.locator('#table-api th[data-sort="max"]');
    const p95 = page.locator('#table-api th[data-sort="percentile"]');
    const value = (key: string) => report.endpoints[key]?.stats?.percentiles['p95'] ?? -1;
    await p95.getByRole('button').click();
    await pw(p95).toHaveAttribute('aria-sort', 'descending');
    let keys = await rowKeys(page, 'api');
    expect(keys.filter((k) => value(k) >= 0).map(value)).toEqual(
      keys
        .filter((k) => value(k) >= 0)
        .map(value)
        .sort((a, b) => b - a),
    );
    await p95.getByRole('button').click();
    await pw(p95).toHaveAttribute('aria-sort', 'ascending');
    await header.getByRole('button').click();
    await pw(p95).not.toHaveAttribute('aria-sort', /.*/u);
    const keyHeader = page.locator('#table-api th[data-sort="key"]');
    await keyHeader.getByRole('button').click();
    keys = await rowKeys(page, 'api');
    expect(keys).toEqual([...keys].sort());
    await page.context().close();

    const reference = referenceReport(10);
    const tests = await open(reference, {}, '#tab=tests');
    const total = tests.page.locator('#table-tests th[data-sort="total"]');
    const titles = () =>
      tests.page
        .locator('#table-tests tbody tr')
        .evaluateAll((rows) => rows.map((r) => Number(r.getAttribute('data-i'))));
    const order = (reference.testBreakdown?.tests ?? []).map((_, i) => i);
    expect(await titles()).toEqual(order);
    await total.getByRole('button').click();
    await pw(total).toHaveAttribute('aria-sort', 'descending');
    expect(await titles()).toEqual(order);
    await total.getByRole('button').click();
    expect(await titles()).toEqual([...order].reverse());
    await tests.page.locator('#table-tests th[data-sort="avg"] button').click();
    await pw(tests.page.locator('#table-tests th[data-sort="avg"]')).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    await tests.page.context().close();
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

  test('11-REQ-38 Copy link writes the address, or shows it in a read-only field when the clipboard fails', async () => {
    const { page } = await open(fullRun(), {}, '#key=api:POST%20%2Fapi%2Forders');
    await page.evaluate(
      'Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("blocked")) } })',
    );
    await page.getByRole('button', { name: 'Copy link' }).click();
    const field = page.getByRole('textbox', { name: 'Link to this key' });
    await pw(field).toBeVisible();
    await pw(field).toHaveValue(`${URL}#key=api:POST%20%2Fapi%2Forders`);
    await page.context().close();
  });

  test('11-AC-27 print: panels visible, controls and drawer hidden, details of violations open, light theme', async () => {
    const { page } = await open(fullRun(), { colorScheme: 'dark' });
    await page.emulateMedia({ media: 'print' });
    for (const tab of TABS) await pw(page.locator(`#tab-${tab}`)).toBeVisible();
    for (const selector of ['.tabs', '.tools', '#download', '#drawer']) {
      await pw(page.locator(selector).first()).toBeHidden();
    }
    const violation = page.locator('#table-api > tbody[data-g="0"]').first();
    await pw(violation.getByRole('table', { name: 'Checks' })).toBeVisible();
    const passing = page.locator('#table-api > tbody[data-g="2"]').first();
    await pw(passing.getByRole('table', { name: 'Checks' })).toBeHidden();
    await pw(page.locator('svg.wf')).toBeVisible();
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

  test('11-AC-27 at 360 px no tab and no open drawer makes the page scroll sideways', async () => {
    const report = referenceReport(10);
    const { page } = await open(report, { viewport: { width: 360, height: 800 } });
    for (const tab of TABS.filter((t) => t !== 'custom')) {
      await page.evaluate(`location.hash = '#tab=${tab}'`);
      await pw(page.locator(`#tab-${tab}`)).toBeVisible();
      expect(await page.evaluate('document.documentElement.scrollWidth'), tab).toBeLessThanOrEqual(
        360,
      );
    }
    await page.evaluate(`location.hash = '#key-api-1'`);
    await pw(drawer(page)).toBeVisible();
    expect(await page.evaluate('document.documentElement.scrollWidth')).toBeLessThanOrEqual(360);
    // Tables and the waterfall scroll inside their containers.
    await page.keyboard.press('Escape');
    await page.evaluate(`location.hash = '#tab=tests'`);
    const scroll = await page
      .locator('.wfs')
      .first()
      .evaluate((s) => [s.scrollWidth, s.clientWidth]);
    expect(scroll[0]).toBeGreaterThan(scroll[1] ?? 0);
    await page.context().close();
  });

  test('11-AC-08 11-AC-26 axe-core: no WCAG A or AA violations in every tab and the open drawer, both themes, 360 and 1280 px', async () => {
    const failures: string[] = [];
    for (const colorScheme of ['light', 'dark'] as const) {
      for (const width of [360, 1280]) {
        for (const report of [fullRun(), markupCase()]) {
          const { page } = await open(report, { colorScheme, viewport: { width, height: 900 } });
          for (const tab of TABS) {
            if ((await page.locator(`[data-tab="${tab}"]`).count()) === 0) continue;
            await page.evaluate(`location.hash = '#tab=${tab}'`);
            await pw(page.locator(`#tab-${tab}`)).toBeVisible();
            for (const v of await axe(page)) failures.push(`${colorScheme} ${width} ${tab}: ${v}`);
          }
          await page.evaluate(`location.hash = '#key-api-1'`);
          await pw(drawer(page)).toBeVisible();
          for (const v of await axe(page)) failures.push(`${colorScheme} ${width} drawer: ${v}`);
          await page.context().close();
        }
      }
    }
    expect(failures).toEqual([]);
  });

  // The time limits of 11-AC-05 and 11-AC-30 are checked in the isolated performance suite
  // (test/perf/html.test.ts, 12-PERF-03, 12-D-05).
  test('11-AC-05 the reference report loads; tabs, drawer and filters work on 500 rows', async () => {
    const { page } = await open(referenceReport(), {}, '#tab=endpoints');
    expect(await page.locator('#table-api > tbody').count()).toBe(500);
    await page.locator('#table-api th[data-sort="max"] button').click();
    expect((await rowKeys(page, 'api')).length).toBe(500);
    await page.locator('[data-for="table-api"]').getByRole('searchbox').fill('resource-00');
    expect((await rowKeys(page, 'api')).length).toBe(100);
    await page.locator('#table-api > tbody:visible a[href^="#key-"]').first().click();
    await pw(drawer(page)).toBeVisible();
    await page.context().close();
  });
});
