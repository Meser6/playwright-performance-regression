// File writing for the reporter and the wizard (01, chapter 4.7).
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { stringifyStable } from '../core/format/index.ts';

/**
 * Writes `text` as UTF-8 atomically: a temporary file in the target directory is renamed over
 * the target, so readers never see a partial file (01-REQ-20). Missing directories are created.
 */
export async function writeTextAtomic(path: string, text: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, text, 'utf8');
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** Writes `value` as stable JSON (sorted keys, 2-space indent, final newline), atomically. */
export async function writeJsonStable(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, stringifyStable(value));
}
