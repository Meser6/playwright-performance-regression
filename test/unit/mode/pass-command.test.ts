// Command of the next pass (04-REQ-63).
import { describe, expect, test } from 'vitest';
import { passCommand } from '../../../src/mode/index.ts';

const NODE = '/usr/bin/node';
const PW = '/p/node_modules/@playwright/test/cli.js';

describe('passCommand (04-REQ-63)', () => {
  test('04-AC-41 an npm script runs again with the added arguments after --', () => {
    expect(
      passCommand({
        execPath: NODE,
        argv: [NODE, PW, 'test', '--project', 'main', '--grep', 'b'],
        env: {
          npm_lifecycle_event: 'e2e',
          npm_lifecycle_script: 'node seed.mjs && playwright test --project main',
          npm_execpath: '/usr/lib/node_modules/npm/bin/npm-cli.js',
        },
      }),
    ).toEqual({
      file: NODE,
      args: ['/usr/lib/node_modules/npm/bin/npm-cli.js', 'run', 'e2e', '--', '--grep', 'b'],
    });
  });

  test('04-AC-41 pnpm takes the arguments without --; a binary package manager is the file', () => {
    const env = {
      npm_lifecycle_event: 'e2e:qa',
      npm_lifecycle_script: 'cross-env ENV=qa playwright test',
    };
    const argv = [NODE, PW, 'test', '--grep', '@cart'];
    expect(
      passCommand({ execPath: NODE, argv, env: { ...env, npm_execpath: '/x/pnpm/bin/pnpm.cjs' } }),
    ).toEqual({ file: NODE, args: ['/x/pnpm/bin/pnpm.cjs', 'run', 'e2e:qa', '--grep', '@cart'] });
    expect(
      passCommand({ execPath: NODE, argv, env: { ...env, npm_execpath: 'C:\\bin\\pnpm.exe' } }),
    ).toEqual({ file: 'C:\\bin\\pnpm.exe', args: ['run', 'e2e:qa', '--grep', '@cart'] });
  });

  test('04-AC-41 pnpm: the script text comes from package.json, its lifecycle script has the added arguments', () => {
    expect(
      passCommand({
        execPath: NODE,
        argv: [NODE, PW, 'test', '--grep', 'cart'],
        env: {
          npm_lifecycle_event: 'e2e',
          npm_lifecycle_script: 'node prep.mjs && playwright test --grep cart',
          npm_execpath: '/x/pnpm.cjs',
        },
        scripts: { e2e: 'node prep.mjs && playwright test' },
      }).args,
    ).toEqual(['/x/pnpm.cjs', 'run', 'e2e', '--grep', 'cart']);
  });

  test('04-AC-41 without a script: the Playwright command line itself', () => {
    const argv = [NODE, PW, 'test', '--grep', '@perf'];
    expect(passCommand({ execPath: NODE, argv, env: {} })).toEqual({
      file: NODE,
      args: [PW, 'test', '--grep', '@perf'],
    });
  });

  test('04-AC-41 a script that does not name Playwright is not run again; expanded words are counted', () => {
    const npm = '/n/npm-cli.js';
    // npm_* variables of an outer script, e.g. a test runner that starts Playwright itself.
    expect(
      passCommand({
        execPath: NODE,
        argv: [NODE, PW, 'test', '--grep', 'x'],
        env: { npm_lifecycle_event: 'test', npm_lifecycle_script: 'vitest run', npm_execpath: npm },
      }),
    ).toEqual({ file: NODE, args: [PW, 'test', '--grep', 'x'] });
    // A script that names Playwright in another segment: run again, no added arguments.
    expect(
      passCommand({
        execPath: NODE,
        argv: [NODE, PW, 'test'],
        env: {
          npm_lifecycle_event: 'e2e',
          npm_lifecycle_script: 'node run-playwright.js',
          npm_execpath: npm,
        },
      }).args,
    ).toEqual([npm, 'run', 'e2e']);
    // $PROJECT expanded by the shell: one word in the script, one word in argv.
    expect(
      passCommand({
        execPath: NODE,
        argv: [NODE, PW, 'test', '--project', 'chromium', '-g', 'cart'],
        env: {
          npm_lifecycle_event: 'e2e',
          npm_lifecycle_script: 'npx playwright test --project "$PROJECT"',
          npm_execpath: npm,
        },
      }).args,
    ).toEqual([npm, 'run', 'e2e', '--', '-g', 'cart']);
  });

  // A1: the package manager sets npm_lifecycle_event also for npx/exec/dlx, which is no script.
  describe('04-AC-41 only a script of package.json runs again', () => {
    const scripts = { test: 'playwright test', e2e: 'node seed.mjs && playwright test' };
    const npm = '/usr/lib/node_modules/npm/bin/npm-cli.js';

    test('npx playwright test: the Playwright command line', () => {
      const argv = [NODE, PW, 'test', '--grep', 'x'];
      const env = {
        npm_lifecycle_event: 'npx',
        npm_lifecycle_script: 'playwright test --grep x',
        npm_execpath: npm,
      };
      expect(passCommand({ execPath: NODE, argv, env, scripts })).toEqual({
        file: NODE,
        args: [PW, 'test', '--grep', 'x'],
      });
      // package.json without scripts: still no script named npx.
      expect(passCommand({ execPath: NODE, argv, env, scripts: {} }).args).toEqual(argv.slice(1));
    });

    test('pnpm exec playwright test: the Playwright command line', () => {
      const argv = [NODE, PW, 'test'];
      const env = {
        npm_lifecycle_event: 'exec',
        npm_lifecycle_script: 'playwright test',
        npm_execpath: '/x/pnpm/bin/pnpm.cjs',
      };
      expect(passCommand({ execPath: NODE, argv, env, scripts })).toEqual({
        file: NODE,
        args: [PW, 'test'],
      });
    });

    test('yarn dlx and yarn playwright test: the Playwright command line', () => {
      const argv = [NODE, PW, 'test'];
      for (const event of ['dlx', 'playwright']) {
        const env = {
          npm_lifecycle_event: event,
          npm_lifecycle_script: 'playwright test',
          npm_execpath: '/x/yarn/bin/yarn.js',
        };
        expect(passCommand({ execPath: NODE, argv, env, scripts }).args).toEqual([PW, 'test']);
      }
    });

    test('npm run test and npm run test -- --grep x: the script again', () => {
      const env = {
        npm_lifecycle_event: 'test',
        npm_lifecycle_script: 'playwright test',
        npm_execpath: npm,
      };
      expect(passCommand({ execPath: NODE, argv: [NODE, PW, 'test'], env, scripts })).toEqual({
        file: NODE,
        args: [npm, 'run', 'test'],
      });
      expect(
        passCommand({
          execPath: NODE,
          argv: [NODE, PW, 'test', '--grep', 'x'],
          env: { ...env, npm_lifecycle_script: 'playwright test --grep x' },
          scripts,
        }),
      ).toEqual({ file: NODE, args: [npm, 'run', 'test', '--', '--grep', 'x'] });
    });

    test('an unreadable package.json falls back to npm_lifecycle_script', () => {
      const env = {
        npm_lifecycle_event: 'e2e',
        npm_lifecycle_script: 'playwright test',
        npm_execpath: npm,
      };
      expect(
        passCommand({ execPath: NODE, argv: [NODE, PW, 'test'], env, scripts: null }).args,
      ).toEqual([npm, 'run', 'e2e']);
    });
  });
});
