import { test } from '../../_shared/fixtures.mjs';

test('body and teardown', async () => {
  await new Promise((r) => setTimeout(r, Number(process.env.PROTO_BODY_MS ?? 0)));
});

test('body with a request in flight', async ({ page }) => {
  test.skip(process.env.PROTO_WITH_REQUEST !== '1');
  await page.goto('/page');
  await page.evaluate(() => {
    fetch('/api/delay?ms=5000&k=v12c').then((r) => r.text()).catch(() => {});
  });
  await new Promise((r) => setTimeout(r, Number(process.env.PROTO_BODY_MS ?? 0)));
});
