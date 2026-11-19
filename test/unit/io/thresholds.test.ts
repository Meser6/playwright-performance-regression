import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readTextFile, relativeSlashPath } from '../../../src/io/files.ts';
import {
  loadThresholds,
  thresholdsFileName,
  thresholdsFilePaths,
} from '../../../src/io/thresholds.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pw-perf-thresholds-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const file = (kind: string, entries: object = {}): string =>
  JSON.stringify({ schemaVersion: 1, kind, generated: null, entries });

describe('thresholds files (09-REQ-01 – 09-REQ-03)', () => {
  test('file names follow 02 chapter 8.1 and thresholds.dir is relative to configDir', () => {
    expect(thresholdsFileName('perf-thresholds', 'api', null)).toBe('perf-thresholds.api.json');
    expect(thresholdsFileName('p', 'custom', 'qa')).toBe('p.custom.qa.json');
    const paths = thresholdsFilePaths({ configDir: dir, dir: 'perf', filePrefix: 'p', env: 'qa' });
    expect(paths.api).toBe(join(dir, 'perf', 'p.api.qa.json'));
    expect(paths.custom).toBe(join(dir, 'perf', 'p.custom.qa.json'));
  });

  test('loaded, missing and invalid files with paths relative to configDir', async () => {
    mkdirSync(join(dir, 'perf'));
    writeFileSync(join(dir, 'perf', 'p.api.json'), file('api'));
    const loaded = await loadThresholds({
      configDir: dir,
      dir: 'perf',
      filePrefix: 'p',
      env: null,
    });
    expect(loaded.api).toMatchObject({ status: 'loaded', kind: 'api', path: 'perf/p.api.json' });
    expect(loaded.custom).toEqual({
      status: 'missing',
      kind: 'custom',
      path: 'perf/p.custom.json',
      envlessFileExists: false,
    });

    writeFileSync(join(dir, 'perf', 'p.custom.json'), file('api'));
    const invalid = await loadThresholds({
      configDir: dir,
      dir: 'perf',
      filePrefix: 'p',
      env: null,
    });
    expect(invalid.custom).toMatchObject({ status: 'invalid', path: 'perf/p.custom.json' });
    if (invalid.custom.status !== 'invalid') throw new Error('unreachable');
    expect(invalid.custom.issues[0]?.code).toBe('THRESHOLDS_KIND_MISMATCH');
  });

  test('09-AC-16 with an environment label the file without the label is not used', async () => {
    writeFileSync(join(dir, 'perf-thresholds.api.json'), file('api'));
    const loaded = await loadThresholds({
      configDir: dir,
      dir: '.',
      filePrefix: 'perf-thresholds',
      env: 'qa',
    });
    expect(loaded.api).toEqual({
      status: 'missing',
      kind: 'api',
      path: 'perf-thresholds.api.qa.json',
      envlessFileExists: true,
    });
    expect(loaded.custom).toMatchObject({ status: 'missing', envlessFileExists: false });
  });

  test('a path that cannot be read is invalid, never a fallback to defaults', async () => {
    mkdirSync(join(dir, 'perf-thresholds.api.json'));
    const loaded = await loadThresholds({
      configDir: dir,
      dir: '.',
      filePrefix: 'perf-thresholds',
      env: null,
    });
    expect(loaded.api.status).toBe('invalid');
  });

  test('readTextFile gives null for a missing file; relativeSlashPath uses forward slashes', async () => {
    expect(await readTextFile(join(dir, 'none.json'))).toBeNull();
    expect(relativeSlashPath(dir, join(dir, 'a', 'b.json'))).toBe('a/b.json');
    expect(relativeSlashPath(dir, dir)).toBe('.');
  });
});
