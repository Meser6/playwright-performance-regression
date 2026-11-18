// Runs the prototype checks for one or both Playwright versions and writes results/<version>.json.
// Usage: node verify.mjs [--version 1.57.0|latest] [check ...]
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, VERSIONS, resolvePlaywrightCli } from './lib.mjs';
import { startServer } from './server.mjs';
import { v01v02, v03, v03Spawn } from './checks/config-loading.mjs';
import { v07 } from './checks/native-ts.mjs';
import { v05, v06, v10, v11 } from './checks/reporter.mjs';
import { v08, v09, v12a, v12e } from './checks/browsers.mjs';
import { v12b, v12c, v12d } from './checks/conditions.mjs';
import { v04 } from './checks/attachments.mjs';

const CHECKS = {
  'V-01+V-02': v01v02,
  'V-03': async (v, srv) => ({ resolve: v03(v), spawnWithSpaceInPath: await v03Spawn(v, srv) }),
  'V-04': v04,
  'V-05': v05,
  'V-06': v06,
  'V-10': v10,
  'V-11': v11,
  'V-08': v08,
  'V-09': v09,
  'V-12a': v12a,
  'V-12b': v12b,
  'V-12c': v12c,
  'V-12d': v12d,
  'V-12e': v12e,
  // Independent of the Playwright version; run once.
  'V-07': (v) => (v === VERSIONS[0] ? v07(v) : 'see 1.57.0.json (Node only, no Playwright involved)'),
};

const args = process.argv.slice(2);
const vi = args.indexOf('--version');
const versions = vi >= 0 ? [args[vi + 1]] : VERSIONS;
const names = args.filter((a, i) => !a.startsWith('--') && (vi < 0 || i !== vi + 1));
const selected = names.length ? names : Object.keys(CHECKS);

mkdirSync(join(ROOT, 'results'), { recursive: true });
const srv = await startServer();
try {
  for (const version of versions) {
    const file = join(ROOT, 'results', `${version}.json`);
    const results = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    results.playwrightVersion = resolvePlaywrightCli(join(ROOT, 'versions', version)).version;
    results.node = process.version;
    results.platform = `${process.platform}-${process.arch}`;
    for (const name of selected) {
      const t0 = Date.now();
      process.stdout.write(`[${version}] ${name} ... `);
      results[name] = await CHECKS[name](version, srv);
      results[name + ':ranAt'] = new Date().toISOString();
      console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s`);
      // Keep machine-specific absolute paths out of the committed results.
      writeFileSync(file, JSON.stringify(results, null, 2).replaceAll(ROOT, '<prototype>') + '\n');
    }
  }
} finally {
  await srv.close();
}
