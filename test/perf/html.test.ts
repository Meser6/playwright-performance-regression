// 12-PERF-03: the HTML report of the reference report of 11-REQ-43 (500 keys, 500 tests,
// 5 waterfalls) and of 500 keys with 5000 retained samples (NF-08): file size, the time until
// the page is loaded in Chromium, and the time of a tab switch, opening the drawer, filtering
// and sorting 500 rows. The size limits are also checked on push by test/unit/html; the time
// limits only here, isolated from the parallel CI suite (12-D-05).
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { describe, expect, test } from 'vitest';
import { renderHtmlReport } from '../../src/html/index.ts';
import { largeReport, referenceReport } from '../unit/html/fixtures.ts';
import { median, recordResult } from './helpers.ts';

const URL = 'http://report.test/report.html';
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_LOAD_MS = 2000;
const MAX_SORT_MS = 200;
const MAX_FILTER_MS = 200;
const MAX_INTERACTION_MS = 100;

/** Median time of an action run 5 times in the page (ms), including a forced layout. */
async function timed(page: Page, action: string): Promise<number> {
  const times = (await page.evaluate(
    `(() => { const out = []; for (let i = 0; i < 5; i++) { const t = performance.now(); ${action}; document.body.offsetHeight; out.push(performance.now() - t); } return out; })()`,
  )) as number[];
  return median(times);
}

describe('12-PERF-03 HTML report of the reference report', () => {
  test('11-AC-04 11-AC-05 11-AC-25 11-AC-30 below 10 MB, loads in under 2 s; tabs, drawer, filters and sorting are fast', async () => {
    const started = performance.now();
    const html = renderHtmlReport(referenceReport());
    const renderMs = performance.now() - started;
    const bytes = Buffer.byteLength(html, 'utf8');
    const samplesBytes = Buffer.byteLength(renderHtmlReport(largeReport(500, 5000)), 'utf8');

    const browser = await chromium.launch();
    const loads: number[] = [];
    const times: Record<string, number> = {};
    try {
      for (let i = 0; i < 5; i++) {
        const context = await browser.newContext();
        await context.route('**/*', (route) =>
          route.request().url() === URL
            ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
            : route.abort(),
        );
        const page = await context.newPage();
        const t = performance.now();
        await page.goto(URL, { waitUntil: 'load' });
        await page.locator('#table-api > tbody').first().waitFor({ state: 'attached' });
        loads.push(performance.now() - t);
        if (i === 0) {
          times['tab'] = await timed(
            page,
            `document.querySelector('[data-tab="' + (i % 2 ? 'overview' : 'endpoints') + '"]').click()`,
          );
          times['drawer'] = await timed(
            page,
            `document.querySelector('#table-api a[href^="#key-"]').click(); document.querySelector('[data-act="close"]').click()`,
          );
          times['filter'] = await timed(
            page,
            `document.querySelector('[data-for="table-api"] [data-v="2"]').click()`,
          );
          for (const column of ['max', 'key', 'percentile']) {
            times[`sort ${column}`] = await timed(
              page,
              `document.querySelector('#table-api th[data-sort="${column}"] button').click()`,
            );
          }
        }
        await context.close();
      }
    } finally {
      await browser.close();
    }
    recordResult('12-PERF-03', {
      keys: 500,
      tests: 500,
      waterfalls: 5,
      bytes,
      bytesWith5000Samples: samplesBytes,
      maxBytes: MAX_BYTES,
      renderMs: Math.round(renderMs),
      loadMs: loads.map(Math.round),
      loadMedianMs: Math.round(median(loads)),
      maxLoadMs: MAX_LOAD_MS,
      medianMs: Object.fromEntries(Object.entries(times).map(([k, v]) => [k, Math.round(v)])),
    });
    expect(bytes).toBeLessThan(MAX_BYTES);
    expect(samplesBytes).toBeLessThan(MAX_BYTES);
    expect(median(loads)).toBeLessThan(MAX_LOAD_MS);
    expect(times['tab']).toBeLessThan(MAX_INTERACTION_MS);
    expect(times['drawer']).toBeLessThan(MAX_INTERACTION_MS);
    expect(times['filter']).toBeLessThan(MAX_FILTER_MS);
    for (const column of ['max', 'key', 'percentile']) {
      expect(times[`sort ${column}`], column).toBeLessThan(MAX_SORT_MS);
    }
  });
});
