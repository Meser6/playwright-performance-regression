// 12-PERF-03: the HTML report of a synthetic run with 500 keys (NF-08, 11-AC-04, 11-AC-05): file
// size and the time until the endpoint table is shown in Chromium. The same limits are checked on
// every push by test/unit/html and test/browser; this run records the numbers.
import { chromium } from '@playwright/test';
import { describe, expect, test } from 'vitest';
import { renderHtmlReport } from '../../src/html/index.ts';
import { largeReport } from '../unit/html/fixtures.ts';
import { median, recordResult } from './helpers.ts';

const URL = 'http://report.test/report.html';
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_LOAD_MS = 2000;

describe('12-PERF-03 HTML report of 500 keys', () => {
  test('11-AC-04 11-AC-05 the report is below 5 MB and shows its table in under 2 s', async () => {
    const started = performance.now();
    const html = renderHtmlReport(largeReport(500, 5000));
    const renderMs = performance.now() - started;
    const bytes = Buffer.byteLength(html, 'utf8');

    const browser = await chromium.launch();
    const loads: number[] = [];
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
        await page.locator('#endpoints-table > tbody').first().waitFor();
        loads.push(performance.now() - t);
        await context.close();
      }
    } finally {
      await browser.close();
    }
    recordResult('12-PERF-03', {
      keys: 500,
      retainedSamples: 5000,
      bytes,
      maxBytes: MAX_BYTES,
      renderMs: Math.round(renderMs),
      loadMs: loads.map(Math.round),
      loadMedianMs: Math.round(median(loads)),
      maxLoadMs: MAX_LOAD_MS,
    });
    expect(bytes).toBeLessThan(MAX_BYTES);
    expect(median(loads)).toBeLessThan(MAX_LOAD_MS);
  });
});
