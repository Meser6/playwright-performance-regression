// The CLI host on Node (04, chapter 6): process streams and signals, files, and the Playwright
// child process started with process.execPath and without a shell (04-REQ-13, NF-05, V-03).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileExists, readTextFile } from '../io/index.ts';
import { peerDependencies, version } from '../../package.json';
import type { CliHost, DirEntry, PlaywrightInstall } from './host.ts';

function isModuleNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'MODULE_NOT_FOUND'
  );
}

/**
 * @playwright/test resolved from `dir` (never from this package, 04-REQ-13): the `bin.playwright`
 * script of its package.json. MODULE_NOT_FOUND means it is not installed (04-REQ-14).
 */
export function resolvePlaywright(dir: string): PlaywrightInstall | null {
  const require = createRequire(join(dir, 'noop.js'));
  let manifest: string;
  try {
    manifest = require.resolve('@playwright/test/package.json');
  } catch (error) {
    if (isModuleNotFound(error)) return null;
    throw error;
  }
  const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
    version?: string;
    bin?: string | Record<string, string>;
  };
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.playwright;
  if (bin === undefined) throw new Error(`${manifest} has no "bin.playwright" entry`);
  return { cliPath: resolve(dirname(manifest), bin), version: pkg.version ?? '0.0.0' };
}

/** Lowest supported Playwright version: the peer dependency range ">=x.y.z" (D-07). */
function minimumPlaywright(): string {
  const range = peerDependencies['@playwright/test'];
  return /\d+\.\d+\.\d+/u.exec(range)?.[0] ?? '0.0.0';
}

export function nodeHost(): CliHost {
  return {
    cwd: process.cwd(),
    paths: { join, resolve, dirname },
    env: process.env,
    platform: process.platform,
    tmpdir: tmpdir(),
    stdout: process.stdout,
    stderr: process.stderr,
    now: () => new Date(),
    random: Math.random,
    packageVersion: version,
    minPlaywrightVersion: minimumPlaywright(),
    // dist/cli.js and dist/reporter.js are siblings (ESM build).
    reporterPath: fileURLToPath(new URL('./reporter.js', import.meta.url)),
    resolvePlaywright,
    spawnNode: (args, options) => spawn(process.execPath, args, options),
    onSignal: (signal, handler) => {
      process.on(signal, handler);
      return () => {
        process.off(signal, handler);
      };
    },
    readText: readTextFile,
    removeFile: (path) => rm(path, { force: true }),
    exists: fileExists,
    isDirectory: async (path) => {
      try {
        return (await stat(path)).isDirectory();
      } catch {
        return false;
      }
    },
    importModule: (url) => import(url),
    listDir: async (path): Promise<DirEntry[]> => {
      try {
        const entries = await readdir(path, { withFileTypes: true });
        return entries
          .map((e) => ({ name: e.name, directory: e.isDirectory() }))
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      } catch {
        return [];
      }
    },
  };
}
