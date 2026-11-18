import { test, expect } from '../../_shared/fixtures.mjs';
import { createTracker } from '../../_shared/fixtures.mjs';

const BASE2 = process.env.PROTO_BASE2 ?? '';

test('V-08 same endpoint with 200 ms delay', async ({ page }) => {
  await page.goto('/page');
  // Warm-up call so that connection setup is not in the measured calls.
  await page.evaluate(() => fetch('/api/delay?ms=0&k=warmup').then((r) => r.text()));
  for (let i = 0; i < 20; i++) {
    await page.evaluate((i) => fetch(`/api/delay?ms=200&k=v08-${i}`).then((r) => r.text()), i);
  }
});

test('V-12a CORS preflight', async ({ page }) => {
  await page.goto('/page');
  for (let i = 0; i < 3; i++) {
    // Custom header forces a preflight; the server answers OPTIONS after 300 ms and GET after 100 ms.
    await page.evaluate(
      ([base2, i]) =>
        fetch(`${base2}/api/delay?ms=100&preflightMs=300&k=preflight-${i}`, { headers: { 'x-custom': '1' } }).then((r) =>
          r.text(),
        ),
      [BASE2, i] as const,
    );
    // Simple cross-origin GET: no preflight.
    await page.evaluate(
      ([base2, i]) => fetch(`${base2}/api/delay?ms=100&preflightMs=300&k=simple-${i}`).then((r) => r.text()),
      [BASE2, i] as const,
    );
  }
});

test('V-12e aborted request texts', async ({ page, context, browser, _perfBuffer }) => {
  // 1. request interrupted by a navigation
  await page.goto('/page');
  await page.evaluate(() => {
    fetch('/api/delay?ms=5000&k=navigation').catch(() => {});
  });
  await page.waitForTimeout(300);
  await page.goto('/page?second');
  // 2. route.abort() without an argument, 3. route.abort('aborted'), 4. route.abort('failed')
  await page.route(/k=route-default/, (r) => r.abort());
  await page.route(/k=route-aborted/, (r) => r.abort('aborted'));
  await page.route(/k=route-failed/, (r) => r.abort('failed'));
  for (const k of ['route-default', 'route-aborted', 'route-failed']) {
    await page.evaluate((k) => fetch(`/api/delay?ms=1&k=${k}`).catch(() => {}), k);
  }
  // 5. page closed while a request is in flight
  const second = await context.newPage();
  await second.goto('/page');
  await second.evaluate(() => {
    fetch('/api/delay?ms=5000&k=page-close').then((r) => r.text()).catch(() => {});
  });
  await second.waitForTimeout(300);
  await second.close();
  await page.waitForTimeout(1000);
  // 6. context closed while a request is in flight (manually tracked context)
  const own = await browser.newContext({ baseURL: process.env.PROTO_BASE });
  const tracker = createTracker(own, 'own-context');
  _perfBuffer.trackers.push(tracker);
  const p = await own.newPage();
  await p.goto('/page');
  await p.evaluate(() => {
    fetch('/api/delay?ms=5000&k=context-close').then((r) => r.text()).catch(() => {});
  });
  await p.waitForTimeout(300);
  await own.close();
  // Give late requestfailed events time to arrive before the test ends.
  await page.waitForTimeout(1000);
  expect(true).toBe(true);
});

test('V-09 request still in flight at test end', async ({ page }) => {
  await page.goto('/page');
  await page.evaluate(() => {
    fetch('/api/delay?ms=3000&k=v09').then((r) => r.text()).catch(() => {});
    // Same endpoint, but the page never reads the response body.
    fetch('/api/delay?ms=3000&k=v09-body-unread').catch(() => {});
  });
  // The test ends right away; the collector has to wait in teardown.
});
