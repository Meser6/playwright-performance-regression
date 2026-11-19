import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createNoise, seededRandom } from '../../demo-server/noise.ts';
import { startDemoServer } from '../../demo-server/server.ts';
import type { DemoServer } from '../../demo-server/server.ts';

const dir = join(import.meta.dirname, '../../demo-server');
let server: DemoServer;

beforeAll(async () => {
  server = await startDemoServer();
});

afterAll(async () => {
  await server.close();
});

async function timed(url: string, init?: RequestInit): Promise<[number, Response]> {
  const start = performance.now();
  const response = await fetch(url, init);
  await response.arrayBuffer();
  return [performance.now() - start, response];
}

describe('demo server', () => {
  test('12-AC-02 starts without dependencies and repeats delays for the same seed', () => {
    for (const file of ['server.ts', 'noise.ts']) {
      const imports = [...readFileSync(join(dir, file), 'utf8').matchAll(/from '([^']+)'/gu)].map(
        (m) => m[1],
      );
      for (const specifier of imports) expect(specifier, file).toMatch(/^(node:|\.\/)/u);
    }
    const sequence = (seed: number) => {
      const noise = createNoise({ seed, sigma: 0.3 });
      return Array.from({ length: 50 }, () => noise(200));
    };
    expect(sequence(7)).toEqual(sequence(7));
    expect(sequence(7)).not.toEqual(sequence(8));
    const values = sequence(7).sort((a, b) => a - b);
    // Log-normal around the median: the sample median is near 200 ms, values stay positive.
    expect(values[25]).toBeGreaterThan(150);
    expect(values[25]).toBeLessThan(260);
    expect(values[0]).toBeGreaterThan(0);
    // Without spread the delay is constant.
    const flat = createNoise({ seed: 1, sigma: 0 });
    expect([flat(300), flat(300)]).toEqual([300, 300]);
    const random = seededRandom(1);
    expect(random()).toBeGreaterThanOrEqual(0);
  });

  test('applies delays per endpoint set by POST /__control', async () => {
    const control = await fetch(`${server.url}/__control`, {
      method: 'POST',
      body: JSON.stringify({ delays: { 'GET /api/orders': 150 } }),
    });
    expect(control.status).toBe(200);
    const [slow] = await timed(`${server.url}/api/orders`);
    const [fast] = await timed(`${server.url}/api/items`);
    expect(slow).toBeGreaterThanOrEqual(145);
    expect(fast).toBeLessThan(145);
    await fetch(`${server.url}/__control`, { method: 'POST', body: '{"delays":{}}' });
    const [delayed] = await timed(`${server.url}/api/delay?ms=120`);
    expect(delayed).toBeGreaterThanOrEqual(115);
  });

  test('serves statuses, redirects, static files and a second origin', async () => {
    expect((await fetch(`${server.url}/api/status?code=500`)).status).toBe(500);
    const redirect = await fetch(`${server.url}/api/redirect?to=/api/data.json`, {
      redirect: 'manual',
    });
    expect([redirect.status, redirect.headers.get('location')]).toEqual([302, '/api/data.json']);
    expect(await (await fetch(`${server.url}/api/data.json`)).json()).toEqual({ data: [1, 2, 3] });
    expect((await fetch(`${server.url}/static/app.js`)).headers.get('content-type')).toBe(
      'text/javascript',
    );
    await expect(fetch(`${server.url}/api/drop`)).rejects.toThrow();
    expect(server.apiUrl).toMatch(/^http:\/\/localhost:\d+$/u);
    expect(server.apiUrl.split(':')[2]).not.toBe(server.url.split(':')[2]);
  });

  test('streams NDJSON and server-sent events until the given time', async () => {
    const [ms, response] = await timed(`${server.url}/api/stream?ms=350`);
    expect(ms).toBeGreaterThanOrEqual(300);
    expect(response.headers.get('content-type')).toBe('application/x-ndjson');
    const events = await fetch(`${server.url}/api/events?ms=250`);
    expect(events.headers.get('content-type')).toBe('text/event-stream');
    expect(await events.text()).toMatch(/^data: 1\n\n/u);
    // Without ms the stream stays open: read the first chunk and stop.
    const open = await fetch(`${server.url}/api/stream`);
    const reader = open.body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toBe('{"n":1}\n');
    await reader?.cancel();
  });

  test('serves the shop page and listens on given ports', async () => {
    const app = await (await fetch(`${server.url}/app`)).text();
    expect(app).toContain("'/api/products', '/api/cart', '/api/users/'");
    const probe = await startDemoServer();
    const ports = [Number(probe.url.split(':')[2]), Number(probe.apiUrl.split(':')[2])];
    await probe.close();
    const fixed = await startDemoServer({ port: ports[0], apiPort: ports[1] });
    try {
      expect([fixed.url, fixed.apiUrl]).toEqual([
        `http://127.0.0.1:${ports[0]}`,
        `http://localhost:${ports[1]}`,
      ]);
    } finally {
      await fixed.close();
    }
  });
});
