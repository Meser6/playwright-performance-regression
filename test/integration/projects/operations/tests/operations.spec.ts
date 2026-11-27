// GraphQL and tRPC calls from the page and from the request fixture (18). The assertions are in
// test/integration/operations.test.ts; the variables carry a marker that must never be recorded.
import { test as base, expect } from '@playwright/test';
import { withPerfFixtures } from '../../../../../dist/fixture.js';

const test = withPerfFixtures(base);
export const MARKER = 'pw-perf-body-marker-7731';

const graphql = (operationName: string, query: string): string =>
  JSON.stringify({ operationName, query, variables: { secret: MARKER } });

test('graphql and trpc from the page', async ({ page }) => {
  await page.goto('/page');
  for (let i = 0; i < 5; i++) {
    const status = await page.evaluate(
      async ([tickets, order]) => {
        const post = (body: string) =>
          fetch('/graphql', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
          }).then(async (r) => {
            await r.text();
            return r.status;
          });
        return [await post(tickets), await post(order)];
      },
      [
        graphql('GetTickets', 'query GetTickets { tickets { id } }'),
        graphql('CreateOrder', 'mutation CreateOrder { createOrder { id } }'),
      ] as const,
    );
    expect(status).toEqual([200, 200]);
  }
  const trpc = await page.evaluate(() =>
    fetch('/api/trpc/b.list,a.get?batch=1&input=%7B%7D').then(async (r) => {
      await r.text();
      return r.status;
    }),
  );
  expect(trpc).toBe(200);
});

test('graphql from the request fixture', async ({ request }) => {
  for (let i = 0; i < 5; i++) {
    const response = await request.post('/graphql', {
      data: { operationName: 'X', query: 'query X { a }', variables: { secret: MARKER } },
    });
    expect(response.status()).toBe(200);
  }
});
