// Small demo server with controllable delays. Listens on two ports so that requests between
// them are cross-origin (CORS preflight check, V-12 a).
//
//   GET  /page                      empty HTML page
//   GET  /api/delay?ms=N            JSON after N ms (CORS enabled)
//   OPTIONS /api/delay?preflightMs=N  preflight answered after N ms
//   GET  /api/hang                  never answers until the server closes
import { createServer } from 'node:http';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function handler(log) {
  return async (req, res) => {
    const url = new URL(req.url, 'http://x');
    log.push({ method: req.method, path: url.pathname, search: url.search, t: Date.now() });
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'x-custom, content-type',
      'access-control-allow-methods': 'GET, POST, PUT',
      // Disable preflight caching so every cross-origin call needs a fresh preflight.
      'access-control-max-age': '0',
    };
    if (req.method === 'OPTIONS') {
      await sleep(Number(url.searchParams.get('preflightMs') ?? 0));
      res.writeHead(204, cors).end();
      return;
    }
    if (url.pathname === '/page') {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>demo</title><p>demo</p>');
      return;
    }
    if (url.pathname === '/api/delay') {
      await sleep(Number(url.searchParams.get('ms') ?? 0));
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === '/api/hang') {
      return; // never answered
    }
    res.writeHead(404).end();
  };
}

export async function startServer(ports = [0, 0]) {
  const log = [];
  const servers = [];
  const bases = [];
  for (const port of ports) {
    const s = createServer(handler(log));
    s.keepAliveTimeout = 1000;
    await new Promise((r) => s.listen(port, r));
    servers.push(s);
    bases.push(`http://127.0.0.1:${s.address().port}`);
  }
  // Second origin uses "localhost" so that host and port both differ.
  bases[1] = bases[1].replace('127.0.0.1', 'localhost');
  return {
    base: bases[0],
    base2: bases[1],
    log,
    close: () =>
      Promise.all(
        servers.map((s) => new Promise((r) => { s.closeAllConnections(); s.close(r); })),
      ),
  };
}
