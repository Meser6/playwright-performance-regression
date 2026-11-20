// Reading files and file paths for the reporter and the CLI (01, chapter 4.7). The reporter may
// not import node:* itself (01, chapter 5), so the path helpers it needs live here too.
import { rmSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

/** Removes a file if it exists; synchronous, for Reporter.onBegin (04-REQ-62). */
export function removeFileSync(path: string): void {
  rmSync(path, { force: true });
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

/**
 * Text of a UTF-8 file, or null when the file does not exist. Other read errors (permissions,
 * a directory at the path) are thrown. A leading BOM is kept, so the parsers reject it as JSON.
 */
export async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Whether something exists at `path`. */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** `path` resolved against the directory `base`; an absolute `path` is returned normalized. */
export function resolvePath(base: string, path: string): string {
  return resolve(base, path);
}

/** Directory part of `path`. */
export function directoryOf(path: string): string {
  return dirname(path);
}

/**
 * `path` relative to the directory `from`, with forward slashes on every system (02-REQ-05).
 * A path on another drive stays absolute.
 */
export function relativeSlashPath(from: string, path: string): string {
  const rel = relative(from, path);
  const shown = rel === '' ? '.' : isAbsolute(rel) ? path : rel;
  return shown.replaceAll('\\', '/');
}
