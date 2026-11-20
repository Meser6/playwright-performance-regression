// The published create package in a fresh Playwright project (13-AC-10): `npm init`,
// `pnpm create` or `yarn create` with --yes installs the package from npm and sets it up, and a
// thresholds run then works against the demo server. Runs only in the release workflow, after
// both packages were published (RELEASE_VERSION, e.g. 0.1.0-next.0; RELEASE_PACKAGE_MANAGER:
// npm, pnpm or yarn); skipped everywhere else, because the version must exist on npm.
// Needs the Chromium of the Playwright version of this repository.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { startDemoServer } from '../demo-server/server.ts';
import type { DemoServer } from '../demo-server/server.ts';
import { copyProject, removeCopies } from '../unit/cli/init-helpers.ts';

const VERSION = process.env['RELEASE_VERSION'] ?? '';
const MANAGER = process.env['RELEASE_PACKAGE_MANAGER'] ?? 'npm';
const PACKAGE = 'playwright-performance-regression';
const TIMEOUT = 10 * 60_000;

const root = join(import.meta.dirname, '../..');
/** The Playwright version whose Chromium the workflow installed. */
const playwrightVersion = (
  JSON.parse(readFileSync(join(root, 'node_modules/@playwright/test/package.json'), 'utf8')) as {
    version: string;
  }
).version;

/** The create command of each package manager, as the README gives it. */
const CREATE: Record<string, string[]> = {
  npm: ['init', `${PACKAGE}@${VERSION}`, '--', '--yes'],
  pnpm: ['create', `${PACKAGE}@${VERSION}`, '--yes'],
  // Yarn 1 cannot run `yarn create <pkg>@<version>` (it calls the bin with the version appended);
  // the check uses current Yarn through corepack.
  yarn: ['create', `${PACKAGE}@${VERSION}`, '--yes'],
};

/** Yarn version used through corepack (`packageManager` in the fresh project). */
const YARN_VERSION = 'yarn@4.18.1';

let server: DemoServer;

beforeAll(async () => {
  if (VERSION !== '') server = await startDemoServer();
});

afterAll(async () => {
  await server?.close();
  removeCopies();
});

/** Runs a command without the npm_* variables of the pnpm that started Vitest. */
function run(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ status: number | null; output: string }> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('npm_') && !name.startsWith('PW_PERF_') && name !== 'PNPM_HOME',
    ),
  );
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...env, CI: '', NO_COLOR: '1', DEMO_URL: server.url },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (status) =>
      resolve({ status, output: `$ ${command} ${args.join(' ')}\n${output}` }),
    );
  });
}

describe.runIf(VERSION !== '')('create package from npm', () => {
  test(
    `13-AC-10 ${MANAGER} create with --yes in a fresh Playwright project gives a working integration`,
    async () => {
      const create = CREATE[MANAGER];
      if (create === undefined) throw new Error(`unknown package manager ${MANAGER}`);
      // A fresh Playwright project: config, tests and @playwright/test, nothing of this package.
      const dir = copyProject('init-esm-ts');
      const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        devDependencies: Record<string, string>;
      };
      manifest.devDependencies['@playwright/test'] = playwrightVersion;
      writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      // Yarn 2+ would use Plug'n'Play; the integration expects node_modules like npm and pnpm.
      writeFileSync(join(dir, '.yarnrc.yml'), 'nodeLinker: node-modules\n');
      if (MANAGER === 'yarn') {
        const pinned = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<
          string,
          unknown
        >;
        pinned['packageManager'] = YARN_VERSION;
        writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pinned, null, 2)}\n`);
      }

      const install = await run(MANAGER, ['install'], dir);
      expect(install.status, install.output).toBe(0);

      const created = await run(MANAGER, create, dir);
      expect(created.status, created.output).toBe(0);
      const after = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        devDependencies: Record<string, string>;
      };
      expect(after.devDependencies[PACKAGE], created.output).toContain(VERSION);
      expect(readdirSync(dir), created.output).toContain('pw-perf.config.ts');

      const installed = JSON.parse(
        readFileSync(join(dir, 'node_modules', PACKAGE, 'package.json'), 'utf8'),
      ) as { version: string };
      expect(installed.version).toBe(VERSION);

      const cli = join(dir, 'node_modules', PACKAGE, 'dist/cli.js');
      const thresholds = await run(process.execPath, [cli, 'thresholds', '--repeat', '5'], dir);
      expect(thresholds.status, thresholds.output).toBe(0);
      expect(thresholds.output).toContain('thresholds derived');
      expect(readdirSync(dir).filter((f) => f.startsWith('pw-perf-thresholds.'))).toEqual([
        'pw-perf-thresholds.api.json',
      ]);
    },
    TIMEOUT,
  );
});
