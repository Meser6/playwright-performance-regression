// Demo application for the integration tests (12, chapter 5): two origins on node:http, no
// dependencies. Run `node test/demo-server/server.ts` to start it on free ports (or on PORT and
// API_PORT from the environment); it prints the two base URLs as JSON on stdout. Tests import
// startDemoServer() instead.
//
// Pages
//   GET /page                       empty HTML page
//   GET /app                        small shop page: loads /api/products, /api/cart and
//                                   /api/users/<id>, then shows <p id="status">ready</p>
//   GET /popup, /tab                pages that call GET /api/popup or /api/tab on load
//   GET /sw-page                    registers /sw.js and waits until it controls the page
//   GET /sw.js                      service worker answering GET /api/sw-cached by itself
//   GET /static/app.js|style.css|logo.png|font.woff2   static files (filters, 05)
// API (CORS enabled, never cached)
//   GET /api/delay?ms=N             JSON after N ms (noise applied, see POST /__control)
//   OPTIONS any                     CORS preflight, answered after ?preflightMs=N ms
//   GET /api/status?code=N          empty response with status N
//   GET /api/drop                   closes the connection without a response (FAILED)
//   GET /api/hang                   never answers (long poll) until the server stops
//   GET /api/redirect?to=PATH       302 to PATH
//   GET /api/stream?ms=N            streamed NDJSON, one line every 100 ms; ends after N ms
//                                   (no ms: never ends until the server stops)
//   GET /api/events?ms=N            server-sent events, one every 100 ms; same end rule
//   GET /api/data.json              JSON with a static-looking extension
//   GET /api/<anything else>        JSON after the delay configured for "<METHOD> <path>"
// Control
//   POST /__control {"delays": {"GET /api/orders": 300}, "noise": {"seed": 1, "sigma": 0.2}}
//   sets delays per endpoint and the noise; {"noise": null} turns the noise off.
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createNoise } from './noise.ts';
import type { NoiseOptions } from './noise.ts';

export interface DemoServer {
  /** http://127.0.0.1:<port> */
  url: string;
  /** Second origin: http://localhost:<other port>, for cross-origin calls. */
  apiUrl: string;
  close(): Promise<void>;
}

interface State {
  delays: Map<string, number>;
  noise: ((medianMs: number) => number) | null;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'x-demo, content-type',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE',
  // No preflight cache: every cross-origin call with a non-safelisted header needs a preflight.
  'access-control-max-age': '0',
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function page(title: string, script = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><p>${title}</p>${script === '' ? '' : `<script>${script}</script>`}</body></html>`;
}

const SERVICE_WORKER = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (new URL(event.request.url).pathname === '/api/sw-cached') {
    event.respondWith(new Response('{"from":"service-worker"}', { headers: { 'content-type': 'application/json' } }));
  }
});
`;

const SW_PAGE_SCRIPT = `
window.swReady = navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then(() =>
  navigator.serviceWorker.controller ? true : new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(true))));
`;

const APP_SCRIPT = `
const user = 1000 + Math.floor(Math.random() * 9000);
Promise.all(['/api/products', '/api/cart', '/api/users/' + user].map((u) => fetch(u).then((r) => r.json()))).then(() => {
  const p = document.createElement('p');
  p.id = 'status';
  p.textContent = 'ready';
  document.body.append(p);
});
`;

/** Writes a chunk every 100 ms until `ms` passed (0: until the connection closes). */
function stream(res: ServerResponse, ms: number, sse: boolean): void {
  res.writeHead(200, {
    'content-type': sse ? 'text/event-stream' : 'application/x-ndjson',
    'cache-control': 'no-store',
    ...CORS,
  });
  const started = Date.now();
  let n = 0;
  const timer = setInterval(() => {
    if (ms > 0 && Date.now() - started >= ms) {
      clearInterval(timer);
      res.end();
      return;
    }
    n += 1;
    res.write(sse ? `data: ${n}\n\n` : `${JSON.stringify({ n })}\n`);
  }, 100);
  res.on('close', () => clearInterval(timer));
}

const STATIC: Record<string, [string, string]> = {
  '/static/app.js': ['text/javascript', 'window.demo = true;'],
  '/static/style.css': ['text/css', 'body { margin: 0; }'],
  '/static/logo.png': ['image/png', ''],
  '/static/font.woff2': ['font/woff2', ''],
};

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res
    .writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS })
    .end(JSON.stringify(body));
}

function delayOf(state: State, key: string, fallback: number): number {
  const median = state.delays.get(key) ?? fallback;
  return state.noise === null ? median : state.noise(median);
}

async function handle(state: State, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://demo.invalid');
  const path = url.pathname;
  const method = req.method ?? 'GET';
  if (method === 'OPTIONS') {
    await sleep(Number(url.searchParams.get('preflightMs') ?? 0));
    res.writeHead(204, CORS).end();
    return;
  }
  if (method === 'POST' && path === '/__control') {
    const body = JSON.parse((await readBody(req)) || '{}') as {
      delays?: Record<string, number>;
      noise?: NoiseOptions | null;
    };
    if (body.delays !== undefined) state.delays = new Map(Object.entries(body.delays));
    if (body.noise !== undefined)
      state.noise = body.noise === null ? null : createNoise(body.noise);
    json(res, 200, { ok: true });
    return;
  }
  const html = (body: string): void => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
  };
  if (path === '/' || path === '/page') return html(page('demo'));
  if (path === '/popup' || path === '/tab') {
    return html(page(path.slice(1), `fetch('/api${path}').then((r) => r.text());`));
  }
  if (path === '/app') return html(page('shop', APP_SCRIPT));
  if (path === '/sw-page') return html(page('service worker', SW_PAGE_SCRIPT));
  if (path === '/sw.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' }).end(SERVICE_WORKER);
    return;
  }
  const file = STATIC[path];
  if (file !== undefined) {
    res.writeHead(200, { 'content-type': file[0] }).end(file[1]);
    return;
  }
  if (path === '/api/delay') {
    await sleep(delayOf(state, `${method} ${path}`, Number(url.searchParams.get('ms') ?? 0)));
    return json(res, 200, { ok: true });
  }
  if (path === '/api/status') {
    res.writeHead(Number(url.searchParams.get('code') ?? 200), CORS).end();
    return;
  }
  if (path === '/api/drop') {
    req.socket.destroy();
    return;
  }
  if (path === '/api/hang') return; // answered never; the server closes the socket on stop
  if (path === '/api/stream' || path === '/api/events') {
    stream(res, Number(url.searchParams.get('ms') ?? 0), path === '/api/events');
    return;
  }
  if (path === '/api/redirect') {
    res.writeHead(302, { location: url.searchParams.get('to') ?? '/api/delay', ...CORS }).end();
    return;
  }
  if (path === '/api/data.json') return json(res, 200, { data: [1, 2, 3] });
  if (path.startsWith('/api/')) {
    await sleep(delayOf(state, `${method} ${path}`, 0));
    return json(res, 200, { path });
  }
  res.writeHead(404).end();
}

function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve((server.address() as AddressInfo).port));
  });
}

export interface DemoServerOptions {
  /** Port of the main origin; 0 or omitted: a free port. */
  port?: number;
  /** Port of the second origin; 0 or omitted: a free port. */
  apiPort?: number;
}

/** Starts both origins, on free ports unless given. */
export async function startDemoServer(options: DemoServerOptions = {}): Promise<DemoServer> {
  const state: State = { delays: new Map(), noise: null };
  const servers = [0, 1].map(() =>
    createServer((req, res) => {
      handle(state, req, res).catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
    }),
  );
  // Loopback only; "localhost" with another port is a different origin for CORS.
  const hosts = ['127.0.0.1', 'localhost'];
  const wanted = [options.port ?? 0, options.apiPort ?? 0];
  const ports = await Promise.all(
    servers.map((server, i) => listen(server, hosts[i] ?? '', wanted[i] ?? 0)),
  );
  return {
    url: `http://127.0.0.1:${ports[0]}`,
    apiUrl: `http://localhost:${ports[1]}`,
    close: () =>
      Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve) => {
              server.closeAllConnections();
              server.close(() => resolve());
            }),
        ),
      ).then(() => undefined),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startDemoServer({
    port: Number(process.env.PORT ?? 0),
    apiPort: Number(process.env.API_PORT ?? 0),
  });
  process.stdout.write(`${JSON.stringify({ url: server.url, apiUrl: server.apiUrl })}\n`);
  const stop = (): void => {
    void server.close().then(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
