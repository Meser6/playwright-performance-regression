// The published create package in a fresh Playwright project (13-AC-10): `npm init`,
// `pnpm create` or `yarn create` installs the package from npm and runs the wizard, which shows
// the plan without a terminal and writes nothing (04-D-38); with an argument it ends with 3 before
// the installation (04-REQ-01). Runs only in the release workflow, after
// both packages were published (RELEASE_VERSION, e.g. 0.1.0-next.0; RELEASE_PACKAGE_MANAGER:
// npm, pnpm or yarn); skipped everywhere else, because the version must exist on npm.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { copyProject, removeCopies, snapshot } from '../unit/cli/init-helpers.ts';

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
  npm: ['init', `${PACKAGE}@${VERSION}`],
  pnpm: ['create', `${PACKAGE}@${VERSION}`],
  // Yarn 1 cannot run `yarn create <pkg>@<version>` (it calls the bin with the version appended);
  // the check uses current Yarn through corepack.
  yarn: ['create', `${PACKAGE}@${VERSION}`],
};
/** The same command with an argument (npm passes it after "--"). */
const WITH_ARGUMENT: Record<string, string[]> = {
  npm: [...(CREATE['npm'] ?? []), '--', '--yes'],
  pnpm: [...(CREATE['pnpm'] ?? []), '--yes'],
  yarn: [...(CREATE['yarn'] ?? []), '--yes'],
};

/** Yarn version used through corepack (`packageManager` in the fresh project). */
const YARN_VERSION = 'yarn@4.18.1';

afterAll(() => {
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
      env: { ...env, CI: '', NO_COLOR: '1' },
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
    `13-AC-10 ${MANAGER} create in a fresh Playwright project installs the package and shows the plan`,
    async () => {
      const create = CREATE[MANAGER];
      const withArgument = WITH_ARGUMENT[MANAGER];
      if (create === undefined || withArgument === undefined)
        throw new Error(`unknown package manager ${MANAGER}`);
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

      // An argument ends with 3 before the installation (04-REQ-01).
      const refused = await run(MANAGER, withArgument, dir);
      expect(refused.status, refused.output).toBe(3);
      expect(refused.output).toContain('takes no arguments');
      const unchanged = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        devDependencies: Record<string, string>;
      };
      expect(unchanged.devDependencies[PACKAGE]).toBeUndefined();

      const before = snapshot(dir);
      const created = await run(MANAGER, create, dir);
      expect(created.status, created.output).toBe(0);
      const after = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
        devDependencies: Record<string, string>;
      };
      expect(after.devDependencies[PACKAGE], created.output).toContain(VERSION);
      // Without a terminal the wizard shows the plan and writes nothing (04-D-38).
      expect(created.output).toContain('no terminal');
      expect(created.output).toContain('+++ b/pw-perf.config.ts');
      const now = snapshot(dir);
      expect(now.has('pw-perf.config.ts')).toBe(false);
      for (const path of ['playwright.config.ts', 'tests/fixtures.ts'])
        expect(now.get(path), path).toBe(before.get(path));

      const installed = JSON.parse(
        readFileSync(join(dir, 'node_modules', PACKAGE, 'package.json'), 'utf8'),
      ) as { version: string };
      expect(installed.version).toBe(VERSION);
    },
    TIMEOUT,
  );
});
