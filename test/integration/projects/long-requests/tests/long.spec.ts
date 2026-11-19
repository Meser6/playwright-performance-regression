import { expect, test } from 'playwright-performance-regression/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/page');
});

test('long poll open at test end', async ({ page }) => {
  const data = await page.evaluate(() => {
    void fetch('/api/hang').catch(() => undefined);
    return fetch('/api/products').then((r) => r.json());
  });
  expect(data).toEqual({ path: '/api/products' });
});

test('streamed fetch open at test end', async ({ page }) => {
  const first = await page.evaluate(async () => {
    const response = await fetch('/api/stream');
    const reader = response.body!.getReader();
    const chunk = await reader.read();
    // Keep reading in the background: the stream never ends.
    void (async () => {
      while (!(await reader.read()).done);
    })().catch(() => undefined);
    return new TextDecoder().decode(chunk.value);
  });
  expect(first).toBe('{"n":1}\n');
});

test('EventSource open at test end', async ({ page }) => {
  const message = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const events = new EventSource('/api/events');
        events.onmessage = (event) => resolve(String(event.data));
      }),
  );
  expect(message).toBe('1');
});
