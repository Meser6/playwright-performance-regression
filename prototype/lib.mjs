// Runner helpers shared by the checks.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const VERSIONS = ['1.57.0', 'latest'];

/** Copies projects/_shared and projects/<name> into versions/<v>/work/ and returns the copy. */
export function prepare(version, name, workName = name) {
  const work = join(ROOT, 'versions', version, 'work');
  mkdirSync(work, { recursive: true });
  rmSync(join(work, '_shared'), { recursive: true, force: true });
  cpSync(join(ROOT, 'projects', '_shared'), join(work, '_shared'), { recursive: true });
  const dir = join(work, workName);
  rmSync(dir, { recursive: true, force: true });
  cpSync(join(ROOT, 'projects', name), dir, { recursive: true });
  return dir;
}

/**
 * V-03: find Playwright's CLI from a project directory the way the package CLI will:
 * resolve @playwright/test/package.json with createRequire and read bin.playwright.
 */
export function resolvePlaywrightCli(projectDir) {
  const req = createRequire(join(projectDir, 'noop.js'));
  const pkgPath = req.resolve('@playwright/test/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.playwright;
  return { pkgPath, version: pkg.version, bin: pkg.bin, cliPath: resolve(dirname(pkgPath), bin) };
}

/** Runs `playwright test <args>` in projectDir via process.execPath (no npx, no shell). */
export function runPlaywright(projectDir, args, { env = {}, outFile, timeoutMs = 180_000 } = {}) {
  const { cliPath } = resolvePlaywrightCli(projectDir);
  if (outFile) rmSync(outFile, { force: true });
  const t0 = Date.now();
  return new Promise((done) => {
    const child = spawn(process.execPath, [cliPath, 'test', ...args], {
      cwd: projectDir,
      shell: false,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0', ...(outFile ? { PROTO_OUT: outFile } : {}), ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const events =
        outFile && existsSync(outFile)
          ? readFileSync(outFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
          : [];
      done({ code, signal, wallMs: Date.now() - t0, stdout, stderr, events });
    });
  });
}

export function runNode(args, { cwd, env = {} } = {}) {
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd, shell: false, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}

export const testEnds = (r) => r.events.filter((e) => e.ev === 'testEnd');
export const samplesOf = (te) => te.attachments.find((a) => a.name === 'pw-perf-samples');
export const firstLine = (s) => (s ?? '').split('\n').find((l) => l.trim()) ?? '';
